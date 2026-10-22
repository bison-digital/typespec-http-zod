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
 * **A constraint or a default `@encode` moves onto a JSON type it does not apply to is dropped and
 * reported, as the document drops it.** See `encodedconstraints.tsp`.
 *
 * `@encode("x", int32) @pattern(...)` on a string emitted `z.int32().regex(...)` and
 * `@encode("x", boolean) @minValue(1)` emitted `z.boolean().min(1)`: neither is a function, so the
 * module threw on import with no diagnostic at all. `@minLength` on a string encoded as an integer
 * became `z.int32().min(2)`, refusing `1`, which the document accepts. A default of the declared type
 * filled a number where the type says `string`, and the emitted set did not compile.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let byDocument: (schema: unknown, value: unknown) => boolean;
let documentOf: {
	components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
};

beforeAll(async () => {
	compiled = await compileFixture(here, "encodedconstraints", { outName: "encodedconstraints" });
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

const VALID = {
	pattern: 5,
	length: 5,
	items: "1",
	flag: true,
	digits: 5,
	alsoDigits: 5,
	since: 1_600_000_000,
};

const ROWS: readonly (readonly [string, readonly unknown[]])[] = [
	["pattern", [5, "5"]],
	["length", [1, 1000, "12"]],
	["items", ["", "1,2,3", [1]]],
	["flag", [true, 1]],
	["digits", [5, "5"]],
	["since", [1_577_836_800, 2_000_000_000, 0]],
	["count", ["7", 7]],
	["on", ["true", true]],
	["color", ["red", "green"]],
];

describe("a constraint @encode moves onto a type it does not apply to", () => {
	it("loads, which `z.int32().regex(...)` and `z.boolean().min(1)` stopped it doing", () => {
		expect(schemas["bodySchema"]).toBeDefined();
		expect(schemas["queryQuery"]).toBeDefined();
	});

	it("is reported once per declaration, as a warning, naming each keyword", () => {
		const warned = compiled.program.diagnostics.map((d) => [d.code, d.severity, d.message]);
		expect(compiled.diagnostics.map((d) => d.code).toSorted()).toEqual([
			"typespec-http-zod/invalid-default",
			"typespec-http-zod/invalid-default",
			...Array.from({ length: 6 }, () => "typespec-http-zod/unenforceable-encoded-constraint"),
		]);
		expect(compiled.diagnostics.every((d) => d.severity === "warning")).toBe(true);
		const text = warned.map(([, , message]) => String(message)).join("\n");
		for (const named of [
			"'@pattern' on 'pattern'",
			"'@minLength', '@maxLength' on 'length'",
			"'@minItems', '@maxItems' on 'items'",
			"'@minValue' on 'flag'",
			"'@pattern' on 'Digits'",
			"The default of 'count' is not emitted",
			"The default of 'on' is not emitted",
		]) {
			expect(text).toContain(named);
		}
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

	it("enforces a date bound under unixTimestamp, which the document publishes as a number", () => {
		expect(documentOf.components.schemas["Body"]?.properties?.["since"]).toMatchObject({
			minimum: 1_577_836_800,
		});
		expect(schemas["bodySchema"]?.safeParse({ ...VALID, since: 0 }).success).toBe(false);
	});

	it("fills no default the encoded type cannot hold, and keeps one it can", () => {
		const parsed = schemas["bodySchema"]?.parse(VALID) as Record<string, unknown>;
		expect("count" in parsed).toBe(false);
		expect("on" in parsed).toBe(false);
		expect(parsed["color"]).toBe("red");
	});

	it("decodes a parameter as the integer its encoding makes it, with no length check", () => {
		const query = schemas["queryQuery"];
		expect(query?.safeParse({ digits: "5", length: "1" }).success).toBe(true);
		expect(query?.safeParse({ digits: "x", length: "1" }).success).toBe(false);
	});

	it("reads ISO8601 on a duration as the form it already has, as rfc3339 on a date-time", () => {
		const emitted = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		expect(/\n\tiso: ([^\n]+),/.exec(emitted)?.[1]).toBe(/\n\tplain: ([^\n]+),/.exec(emitted)?.[1]);
		expect(/\n\tplain: ([^\n]+),/.exec(emitted)?.[1]).toContain("z.iso.duration()");
	});

	it("emits a set that compiles, the validator and contract types identical", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
