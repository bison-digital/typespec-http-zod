import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **An `@encode` whose published schema no value satisfies, or which states no type, is refused.**
 * See `encodingdegenerate.tsp`.
 *
 * openapi3 publishes `@encode("x", string) filter: Filter` as `{ $ref: Filter, type: "string" }`: an
 * object and a string at once, which nothing is. This emitter validated `z.string()` beside it, so a
 * request the document refuses was accepted. Refused as `unsatisfiable-encoding`, an error, the way
 * `undeclared-discriminator` refuses a discriminator the document cannot state: the remedy is in the
 * spec, and no artefact contradicts the document meanwhile.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let documentOf: {
	components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
};

beforeAll(async () => {
	compiled = await compileFixture(here, "encodingdegenerate", { outName: "encodingdegenerate" });
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		// As the fixture was compiled: an unsealed document graded against a sealed validator
		// hides any disagreement about which properties may exist.
		"seal-object-schemas": true,
	});
	documentOf = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as typeof documentOf;
}, 300_000);

/**
 * The property, a value of the encoded scalar's own type that the old validator accepted, what the
 * document says of it, and the part of the message that says why.
 */
const BODY_PROPERTIES: readonly (readonly [string, unknown, boolean, string])[] = [
	["filter", "x", false, "the document accepts nothing"],
	["tags", "a,b", false, "the document accepts nothing"],
	["word", 5, false, "the document accepts nothing"],
	["level", "low", false, "the document accepts nothing"],
	["at", 5, false, "the document accepts nothing"],
	// A scalar that is not standard states no type, so the document accepts anything.
	["text", "x", true, "the document accepts any value"],
	// Only `null` survives the encoded type, and the message says so rather than "nothing".
	["onlyNull", null, true, "the document accepts only null"],
	["half", 1.5, false, "the document accepts nothing"],
	["stamp", "2020-01-01T00:00:00Z", false, "the document accepts nothing"],
	// Two `null`s are two members, so the encoded `type` lands on the whole union: nothing is left.
	["intTwice", null, false, "the document accepts nothing"],
	// A refused value takes no default: `z.never().default(...)` did not compile.
	["filterDefault", "x", false, "the document accepts nothing"],
];

describe("an @encode no value can satisfy", () => {
	it("is refused once per declaration, as an error, and nothing else is reported", () => {
		expect(compiled.diagnostics).toEqual(
			// The body's rows, the query's filter, and the scalar a union member is.
			[...BODY_PROPERTIES, ["query filter"], ["Typeless"]].map(() => ({
				code: "typespec-http-zod/unsatisfiable-encoding",
				severity: "error",
			})),
		);
	});

	for (const [property, value, accepted, why] of BODY_PROPERTIES) {
		it(`${property}: is refused, saying what the document makes of ${JSON.stringify(value)}`, () => {
			const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
			const schema = documentOf.components.schemas["Body"]?.properties?.[property];
			const document = ajv.validate(
				{ ...(schema as object), components: documentOf.components },
				value,
			);
			expect(document).toBe(accepted);
			expect(
				compiled.program.diagnostics.some(
					(d) =>
						d.code === "typespec-http-zod/unsatisfiable-encoding" &&
						d.message.startsWith(`'${property}'`) &&
						d.message.includes(why),
				),
			).toBe(true);
		});
	}

	it("emits a validator that accepts nothing in its place", () => {
		const schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		for (const [property] of BODY_PROPERTIES) {
			expect(schemas).toMatch(new RegExp(`\\b${property}: z\\.never\\(\\)`));
		}
	});

	it("emits a set that loads and compiles, a refused member or default included", async () => {
		await expect(import(join(compiled.outDir, "schemas.gen.ts"))).resolves.toBeDefined();
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
