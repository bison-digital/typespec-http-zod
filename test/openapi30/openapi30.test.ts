import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { componentsAt30, type Direction } from "../support/oas30.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A validator agrees with the OpenAPI version openapi3 publishes, and 3.0 is its default.**
 *
 * 0.31.0 read every document as 3.1 reads it, and openapi3 publishes 3.0.0 unless a project says
 * otherwise. The two dialects answer one schema differently in three places this suite pins, each
 * graded by Ajv on the 3.0 document openapi3 writes from the same program, read as OAS 3.0.4 says -
 * `test/support/oas30.ts`:
 *
 * - **A required read-only property is required "on the response only"** at 3.0, so a request may
 *   leave a server-assigned `id` out; 0.31.0 refused every such create body. Where openapi3 publishes
 *   3.0 and 3.1 at once no request validator agrees with both, and `ambiguous-read-only` says so.
 * - **`nullable` takes effect only beside `type`**, so `Inner | null`, `Color | null` and `"a" | "b" |
 *   null` are published refusing `null`; refused as `unpublishable-null`, where `string | null` and
 *   its kin, published with a `type`, validate as before.
 * - **A sealed model is sealed with `additionalProperties`**, which cannot see a base record in
 *   `allOf`; refused as `unpublishable-record`, where the record spread onto the model is open.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const ajv = new Ajv2020.default({ strict: false, validateFormats: false });

async function load(
	name: string,
	versions: readonly string[] | null,
): Promise<{
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
	readonly codes: readonly string[];
	readonly messages: readonly string[];
}> {
	const compiled = await compileFixture(here, name, {
		outName: `${name}-${versions?.join("_") ?? "default"}`,
		openapiVersions: versions,
	});
	const diagnostics = compiled.program.diagnostics.filter((d) =>
		d.code.startsWith("typespec-http-zod/"),
	);
	const schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
		string,
		ZodType
	>;
	return {
		compiled,
		schemas,
		codes: diagnostics.map((d) => d.code.slice("typespec-http-zod/".length)),
		messages: diagnostics.map((d) => String(d.message)),
	};
}

/** The 3.0 document openapi3 writes from `program`, judging `value` as `component` for `direction`. */
async function documentAt30(program: CompiledFixture["program"]) {
	const [record] = await getOpenAPI3(program, {
		"openapi-versions": ["3.0.0"],
		"seal-object-schemas": true,
	});
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as { components?: { schemas?: Record<string, unknown> } };
	return (component: string, direction: Direction, value: unknown): boolean =>
		ajv.validate(
			{
				$ref: `#/components/schemas/${component}`,
				components: componentsAt30(document, direction),
			},
			value,
		);
}

describe("a required read-only property", () => {
	const noIds = { name: "a", items: [{ label: "x" }] };
	const ids = { id: "1", name: "a", items: [{ id: "2", label: "x" }] };

	it("may be left out of a 3.0 request, by the reading the route applies, nested ones included", async () => {
		const { compiled, schemas, codes } = await load("readonly", null);
		expect(codes).toEqual([]);
		const judge = await documentAt30(compiled.program);
		for (const value of [noIds, ids, { name: "a", items: [{ id: 2, label: "x" }] }, {}]) {
			expect(schemas["widgetCreateSchema"]?.safeParse(value).success, JSON.stringify(value)).toBe(
				judge("Widget", "request", value),
			);
			expect(schemas["widgetSchema"]?.safeParse(value).success, JSON.stringify(value)).toBe(
				judge("Widget", "response", value),
			);
		}
		expect(judge("Widget", "request", noIds)).toBe(true);
		expect(judge("Widget", "response", noIds)).toBe(false);
		// A create-only view holding the shared model reads it as the request does.
		expect(schemas["orderSchema"]?.safeParse({ secret: "s", widget: noIds }).success).toBe(true);
	});

	it("is left out of the request's contract type too, which the wire assertion holds to the validator", async () => {
		const { compiled } = await load("readonly", null);
		const requests = readFileSync(join(compiled.outDir, "requests.gen.ts"), "utf8");
		expect(requests).toMatch(/export interface WidgetCreate \{\n\tid\?: string;/);
		expect(requests).toMatch(/export interface ItemCreate \{\n\tid\?: string;/);
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	it("is required in a 3.1 request, where readOnly is an annotation", async () => {
		const { schemas, codes } = await load("readonly", ["3.1.0"]);
		expect(codes).toEqual([]);
		expect(schemas["widgetCreateSchema"]).toBeUndefined();
		expect(schemas["widgetSchema"]?.safeParse(noIds).success).toBe(false);
		expect(schemas["widgetSchema"]?.safeParse(ids).success).toBe(true);
	});

	it("is refused where openapi3 publishes 3.0 and 3.1, whose requests read it apart", async () => {
		const { codes, messages } = await load("readonly", ["3.0.0", "3.1.0"]);
		expect(codes).toEqual(["ambiguous-read-only", "ambiguous-read-only"]);
		expect(messages[0]).toContain(
			"'RO.Widget' is sent in a request and holds the required read-only property 'RO.Widget.id'",
		);
		expect(messages[1]).toContain("'RO.Order'");
		expect(messages[1]).toContain("'Create<RO.Widget>'");
	});
});

describe("a null the 3.0 document cannot publish", () => {
	it("is refused, each one named, where openapi3 publishes 3.0", async () => {
		const { codes, messages } = await load("nullable-refused", null);
		expect(codes).toEqual(Array(7).fill("unpublishable-null"));
		expect(messages.map((message) => /^'([^']+)'/.exec(message)?.[1]).toSorted()).toEqual([
			'"a" | "b" | null',
			"Refused.Code | null",
			"Refused.Color | null",
			"Refused.Inner | null",
			"Refused.Named | null",
			"null",
			"string | int32 | null",
		]);
		expect(messages[0]).toContain("Set 'openapi-versions: [\"3.1.0\"]'");
	});

	it("is the null each refused shape's 3.0 schema refuses, measured", async () => {
		const { compiled } = await load("nullable-refused", ["3.1.0"]);
		const judge = await documentAt30(compiled.program);
		for (const key of ["inner", "color", "pick", "code", "pair", "named"]) {
			expect(judge("R", "response", { [key]: null }), key).toBe(false);
		}
		// A bare `null` is `{ nullable: true }` at 3.0, which is any value.
		expect(judge("R", "response", { bare: "anything" })).toBe(true);
	});

	it("is not refused at 3.1, which says null", async () => {
		const { codes } = await load("nullable-refused", ["3.1.0"]);
		expect(codes).toEqual([]);
	});

	it("is published, and validated, where nullable sits beside a type", async () => {
		const { compiled, schemas, codes } = await load("nullable-published", null);
		expect(codes).toEqual([]);
		const judge = await documentAt30(compiled.program);
		const keys = ["text", "count", "list", "rec", "expr", "anything", "namedNull", "mixed"];
		for (const key of keys) {
			for (const value of [null, 5, "a"]) {
				expect(
					schemas["pSchema"]?.safeParse({ [key]: value }).success,
					`${key} ${String(value)}`,
				).toBe(judge("P", "response", { [key]: value }));
			}
			expect(judge("P", "response", { [key]: null }), key).toBe(true);
		}
	});
});

describe("a sealed model whose base is a record", () => {
	it("is refused where openapi3 publishes 3.0, whose seal refuses every key the record admits", async () => {
		const { compiled, codes, messages } = await load("record", null);
		expect(codes).toEqual(["unpublishable-record"]);
		expect(messages[0]).toContain("'RecordBase.Extends' extends the record");
		expect(messages[0]).toContain("spread the record onto the model");
		const judge = await documentAt30(compiled.program);
		expect(judge("Extends", "response", { name: "a", other: "b" })).toBe(false);
		expect(judge("Spreads", "response", { name: "a", other: "b" })).toBe(true);
	});

	it("is open as the spread record, at 3.0 as at 3.1", async () => {
		const { schemas } = await load("record", null);
		expect(schemas["spreadsSchema"]?.safeParse({ name: "a", other: "b" }).success).toBe(true);
		expect(schemas["spreadsSchema"]?.safeParse({ name: "a", other: 1 }).success).toBe(false);
	});

	it("is not refused at 3.1, whose seal sees the record", async () => {
		const { schemas, codes } = await load("record", ["3.1.0"]);
		expect(codes).toEqual([]);
		expect(schemas["extendsSchema"]?.safeParse({ name: "a", other: "b" }).success).toBe(true);
	});
});
