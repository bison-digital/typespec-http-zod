import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/** See `derivedscalars.tsp`. The document is the oracle: every verdict is compared against it. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let validator: ZodType;
let byDocument: (value: unknown) => boolean;
let components: Record<string, Record<string, unknown>>;

const valid = {
	inherits: "abc",
	shortWord: "abc",
	overrides: "xx",
	deeper: "ab",
	digit: 5,
	atLeastFive: 7,
};

beforeAll(async () => {
	compiled = await compileFixture(here, "derivedscalars", { outName: "derivedscalars" });
	const schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
		string,
		ZodType
	>;
	validator = schemas["valuesSchema"] as ZodType;
	const [record] = await getOpenAPI3(compiled.program, { "openapi-versions": ["3.1.0"] });
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as { components: { schemas: Record<string, Record<string, unknown>> } };
	components = document.components.schemas;
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	byDocument = ajv.compile({
		$ref: "#/components/schemas/Values",
		components: document.components,
	}) as (value: unknown) => boolean;
}, 300_000);

describe("what the document publishes for a derived scalar", () => {
	/**
	 * Pinned, because the emitter mirrors it: if openapi3 stopped inheriting or stopped overriding,
	 * the rows below would be grading the emitter against a rule the document no longer follows.
	 */
	it("inherits the base's constraints, and overrides a keyword the derived scalar declares", () => {
		expect(components["Inherits"]).toMatchObject({ pattern: "^[a-w]+$" });
		expect(components["ShortWord"]).toMatchObject({ pattern: "^[a-w]+$", maxLength: 3 });
		expect(components["Overrides"]).toMatchObject({ pattern: "^x+$" });
		expect(components["Deeper"]).toMatchObject({ pattern: "^[a-w]+$", maxLength: 3 });
		expect(components["Digit"]).toMatchObject({ minimum: 1, maximum: 9 });
		expect(components["AtLeastFive"]).toMatchObject({ minimum: 5 });
	});
});

describe("the validator for a derived scalar", () => {
	it("compiles without a diagnostic", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	const rows: readonly (readonly [string, unknown])[] = [
		["inherits", "abc"],
		["inherits", "ABC"],
		["inherits", "xyz"],
		["shortWord", "abcd"],
		["shortWord", "AB"],
		["overrides", "xx"],
		["overrides", "abc"],
		["deeper", "abcd"],
		["deeper", "Ab"],
		["deeper", "ab"],
		["digit", 0],
		["digit", 10],
		["digit", 9],
		["atLeastFive", 4],
		["atLeastFive", 5],
	];

	for (const [key, value] of rows) {
		it(`answers ${key} = ${JSON.stringify(value)} as the document does`, () => {
			const body = { ...valid, [key]: value };
			expect(validator.safeParse(body).success).toBe(byDocument(body));
		});
	}

	it("is not vacuous: the document refuses some rows and accepts others", () => {
		const verdicts = rows.map(([key, value]) => byDocument({ ...valid, [key]: value }));
		expect(verdicts.filter(Boolean).length).toBe(5);
		expect(verdicts.filter((verdict) => !verdict).length).toBe(10);
		expect(byDocument(valid)).toBe(true);
	});
});
