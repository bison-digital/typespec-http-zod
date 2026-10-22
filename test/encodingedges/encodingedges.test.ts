import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **`@encode` where what the document publishes depends on more than the declared type's kind.** See
 * `encodingedges.tsp`. Each was found by grading a fixture against the document, after the rule for
 * `@encode` had been rewritten once:
 *
 * - `"a" | null | null` publishes three members, so the encoded `type` lands on the whole `anyOf` and
 *   refuses `null`; `null` was accepted.
 * - a named `MaybeTime { utcDateTime, null }` is a `$ref`, so `rfc3339` on it refuses `null` too;
 *   `Opt<"a">`, a union template instance with an argument that has no name, is published inline,
 *   so `null` survives beside `"a"`.
 * - an HTTP-date is the value of `rfc7231` on a union holding a date-time, where the member's ISO
 *   check was kept and every HTTP-date refused.
 * - `scalar Mystery;` publishes `{}`, which an integer encoding narrows to integers; read as a string
 *   it was refused as unsatisfiable.
 * - a constraint on a union, encoded or not, emitted `z.union(...).min(2)`, and the module threw.
 * - a scalar-constructor default under `unixTimestamp` is the number the document publishes.
 * - `int32[] | null` as a comma-delimited query parameter was never split.
 * - an operation named `exploded` had a query validator named after the helper `explodedQuery`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let byDocument: (schema: unknown, value: unknown) => boolean;
let documentOf: {
	components: Record<string, unknown>;
	paths: Record<string, { get?: { parameters?: { name: string; schema: unknown }[] } }>;
};

beforeAll(async () => {
	compiled = await compileFixture(here, "encodingedges", { outName: "encodingedges" });
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		"seal-object-schemas": true,
	});
	documentOf = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as typeof documentOf;
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	byDocument = (schema, value) =>
		ajv.validate({ ...(schema as object), components: documentOf.components }, value);
}, 300_000);

const HTTP_DATE = "Wed, 21 Oct 2015 07:28:00 GMT";
const VALID = {
	twoNulls: "a",
	maybeTime: "2020-01-01T00:00:00Z",
	maybeDur: "P1D",
	httpOrNow: HTTP_DATE,
	moment: HTTP_DATE,
	mystery: 5,
	encodedUnion: "ab",
	plainUnion: "ab",
	opt: "a",
	withUnknown: "ab",
};

const ROWS: readonly (readonly [string, readonly unknown[]])[] = [
	["twoNulls", ["a", null, "b"]],
	["maybeTime", ["2020-01-01T00:00:00Z", null]],
	["maybeDur", ["P1D", null]],
	["httpOrNow", [HTTP_DATE, "now", 5]],
	["moment", [HTTP_DATE, "now", 5]],
	["mystery", [5, "5"]],
	["encodedUnion", ["ab", null, "a"]],
	["plainUnion", ["ab", 5, "a", true]],
	["opt", ["a", null, "b"]],
	["unixDefault", [1_577_836_800, "2020-01-01T00:00:00Z"]],
	["isoDefault", ["2020-01-01T00:00:00Z", 5]],
	// `unknown` beside `string`: the keyword constrains whatever value is a string, and only that.
	["withUnknown", ["ab", 5, null, "a"]],
	["ts2Default", [1, "2020-01-01T00:00:00Z"]],
	["txtDefault", ["5", 5]],
];

describe("@encode where the document's form decides", () => {
	it("loads, and reports only the defaults no value of the type can be", () => {
		expect(schemas["bodySchema"]).toBeDefined();
		expect(compiled.diagnostics).toEqual([
			{ code: "typespec-http-zod/invalid-default", severity: "warning" },
			{ code: "typespec-http-zod/invalid-default", severity: "warning" },
		]);
		const text = compiled.program.diagnostics.map((d) => d.message).join("\n");
		expect(text).toContain("The default of 'ts2Default' is not emitted");
		expect(text).toContain("The default of 'txtDefault' is not emitted");
	});

	for (const [key, values] of ROWS) {
		it(`${key}: answers ${values.map((v) => JSON.stringify(v)).join(", ")} as the document does`, () => {
			const verdicts = values.map((value) => {
				const body = { ...VALID, [key]: value };
				const validator = schemas["bodySchema"]?.safeParse(body).success;
				const document = byDocument({ $ref: "#/components/schemas/Body" }, body);
				expect(validator, `${key} = ${JSON.stringify(value)}`).toBe(document);
				return document;
			});
			expect(verdicts).toContain(true);
			expect(verdicts).toContain(false);
		});
	}

	it("fills a scalar-constructor default as the value the document publishes", () => {
		const parsed = schemas["bodySchema"]?.parse(VALID) as Record<string, unknown>;
		expect(parsed["unixDefault"]).toBe(1_577_836_800);
		expect(parsed["isoDefault"]).toBe("2020-01-01T00:00:00Z");
		expect(parsed["listDefault"]).toEqual(["2020-01-01T00:00:00Z"]);
		// Its type is an integer and the document's default a string: no fallback is both.
		expect("ts2Default" in parsed).toBe(false);
		expect("txtDefault" in parsed).toBe(false);
	});

	it("splits a cookie list as the document's form style joins it", () => {
		expect(schemas["cookieCookie"]?.safeParse({ ids: "1,2", maybe: "3,4" }).success).toBe(true);
		expect(schemas["cookieCookie"]?.safeParse({ ids: "1,x" }).success).toBe(false);
	});

	it("gathers a form-exploded record that may be null, as the document reads it", () => {
		expect(schemas["byRecordQuery"]?.parse({ a: "1" })).toEqual({ rec: { a: 1 } });
		expect(schemas["byRecordQuery"]?.safeParse({ a: "x" }).success).toBe(false);
	});

	it("names a validator by an operation id that is not an identifier", () => {
		const emitted = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		expect(emitted).toContain("export const get_widgetQuery =");
		expect(schemas["get_widgetQuery"]?.safeParse({ q: "x" }).success).toBe(true);
	});

	it("splits a nullable comma-delimited query list, as the document's style says", () => {
		const parameter = documentOf.paths["/list"]?.get?.parameters?.[0];
		expect(byDocument(parameter?.schema, [1, 2])).toBe(true);
		expect(schemas["listQuery"]?.safeParse({ ids: "1,2" }).success).toBe(true);
		expect(schemas["listQuery"]?.safeParse({ ids: "1,x" }).success).toBe(false);
	});

	it("names an operation's validator apart from the helpers the module declares", () => {
		const emitted = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		expect(emitted).toContain("export const explodedQuery_ =");
		expect(schemas["explodedQuery_"]?.safeParse({ a: "1" }).success).toBe(true);
	});

	it("emits a set that compiles, the validator and contract types identical", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
