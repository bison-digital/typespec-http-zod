import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A parameter arrives as text, whatever the document says it means.**
 *
 * `?limit=10` is the string `"10"`, and a validator built from a document saying `type: integer`
 * refuses it unless the wire form is decoded first. That was fixed once, measured as
 * `GET /pet/1 -> 400` against a live server, and the fix was applied by inspecting the EMITTED TEXT:
 * anything beginning `z.number()` got a decoder wrapped around it.
 *
 * A string about a string fails silently the moment the expression is spelled another way, and it
 * did. `@query size: 10 | 25 | 50` emits `z.union([z.literal(10), ...])`, which begins with neither,
 * so no decoder was wrapped and every conformant caller got a 400. **No document comparison could
 * see it**: both sides agree the parameter is a number with an enum of three values. The
 * disagreement is with the wire, which only a request can reveal.
 *
 * So this asserts the CLASS - every numeric or boolean parameter accepts its wire form - rather than
 * the one shape that broke. The decision now reads the TYPE, and these are the shapes a type can
 * take.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

/** A query or path bag exactly as a server hands one over: every value a string. */
const wire = (values: Record<string, string>): Record<string, string> => values;

describe("every numeric or boolean parameter accepts the string the wire delivers", () => {
	let compiled: CompiledFixture;
	let schemas: Record<string, ZodType>;

	beforeAll(async () => {
		compiled = await compileFixture(here, "params");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	}, 120_000);

	it("compiles and emits a validator per parameter group", () => {
		expect(compiled.diagnostics).toEqual([]);
		// Non-vacuity: every arm below reads one of these and would pass trivially against none.
		const groups = Object.keys(schemas).filter((name) => /(Path|Query)$/.test(name));
		expect(groups.length).toBeGreaterThanOrEqual(7);
	});

	it("decodes a plain integer and boolean", () => {
		expect(schemas["plainPath"]?.safeParse(wire({ id: "7" })).success).toBe(true);
		expect(schemas["plainQuery"]?.safeParse(wire({ limit: "10", verbose: "true" })).success).toBe(
			true,
		);
	});

	it("decodes a named scalar carrying a constraint, and still enforces it", () => {
		expect(schemas["namedPath"]?.safeParse(wire({ petId: "7" })).success).toBe(true);
		// `@minValue(1)` still applies after decoding, or the decode has eaten the constraint.
		expect(schemas["namedPath"]?.safeParse(wire({ petId: "0" })).success).toBe(false);
	});

	it("decodes a union of numeric literals, which is the shape that was silently missed", () => {
		const query = schemas["literalsQuery"];
		expect(query?.safeParse(wire({ size: "25" })).success).toBe(true);
		expect(query?.safeParse(wire({ size: "50" })).success).toBe(true);
		// A value the document does not offer is still refused, so the decode has not widened it.
		expect(query?.safeParse(wire({ size: "99" })).success).toBe(false);
	});

	it("decodes a boolean literal", () => {
		expect(schemas["boolLiteralQuery"]?.safeParse(wire({ only: "true" })).success).toBe(true);
		expect(schemas["boolLiteralQuery"]?.safeParse(wire({ only: "false" })).success).toBe(false);
	});

	it("decodes through optional and nullable wrappers", () => {
		const query = schemas["optionalNumericQuery"];
		expect(query?.safeParse(wire({})).success).toBe(true);
		expect(query?.safeParse(wire({ offset: "5", ratio: "1.5" })).success).toBe(true);
	});

	it("splits a flattened list and decodes each element", () => {
		expect(schemas["listQuery"]?.safeParse(wire({ ids: "1,2,3" })).success).toBe(true);
		expect(schemas["listQuery"]?.safeParse(wire({ ids: "1,nope,3" })).success).toBe(false);
	});

	it("decodes, rather than coerces", () => {
		/**
		 * `z.coerce.number()` would make `Number("")` into `0`, so an empty value the document forbids
		 * would sail through as zero. A value that is not a well-formed number is passed along unchanged
		 * and fails against the schema the document published.
		 */
		expect(schemas["plainQuery"]?.safeParse(wire({ limit: "", verbose: "true" })).success).toBe(
			false,
		);
		expect(schemas["plainQuery"]?.safeParse(wire({ limit: "abc", verbose: "true" })).success).toBe(
			false,
		);
	});

	it("leaves a string parameter alone, so the rule is not applied to everything", () => {
		const source = schemas["textQuery"];
		expect(source?.safeParse(wire({ name: "anything" })).success).toBe(true);
	});
});
