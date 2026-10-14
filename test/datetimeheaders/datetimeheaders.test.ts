import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { GRADED_OPENAPI_VERSIONS } from "../conformance/corpus.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/** See `datetimeheaders.tsp`. Each header is graded against the format the document publishes. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let source: string;

const HTTP_DATE = "Fri, 26 Aug 2022 14:38:00 GMT";
const RFC_3339 = "2022-08-26T14:38:00Z";

interface Schema {
	readonly format?: string;
	readonly $ref?: string;
	readonly items?: Schema;
	readonly anyOf?: readonly Schema[];
}

interface Document {
	readonly components?: { readonly schemas?: Readonly<Record<string, Schema>> };
	readonly paths: Readonly<
		Record<
			string,
			{
				readonly get: {
					readonly parameters?: readonly { readonly name: string; readonly schema: Schema }[];
					readonly responses: Readonly<
						Record<
							string,
							{ readonly headers?: Readonly<Record<string, { readonly schema: Schema }>> }
						>
					>;
				};
			}
		>
	>;
}

const documents: Record<string, Document> = {};

beforeAll(async () => {
	compiled = await compileFixture(here, "datetimeheaders", { outName: "datetimeheaders" });
	source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	for (const version of GRADED_OPENAPI_VERSIONS) {
		const [record] = await getOpenAPI3(compiled.program, { "openapi-versions": [version] });
		documents[version] = JSON.parse(
			JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
		) as Document;
	}
}, 300_000);

/** The date-time format a header's value is published under, wherever in its schema it sits. */
function formatOf(schema: Schema, document: Document): string | undefined {
	if (schema.$ref !== undefined) {
		const target = document.components?.schemas?.[schema.$ref.split("/").at(-1) ?? ""];
		return target === undefined ? undefined : formatOf(target, document);
	}
	return (
		schema.format ??
		(schema.items === undefined ? undefined : formatOf(schema.items, document)) ??
		schema.anyOf?.map((branch) => formatOf(branch, document)).find((format) => format !== undefined)
	);
}

/** Every header the document publishes, with the validator object it is checked by. */
function headersOf(document: Document): readonly (readonly [string, string, string | undefined])[] {
	const rows: (readonly [string, string, string | undefined])[] = [];
	for (const parameter of document.paths["/request"]?.get.parameters ?? []) {
		rows.push(["requestHeader", parameter.name, formatOf(parameter.schema, document)]);
	}
	for (const [name, header] of Object.entries(
		document.paths["/response"]?.get.responses["204"]?.headers ?? {},
	)) {
		rows.push(["responseResponse204Headers", name, formatOf(header.schema, document)]);
	}
	return rows;
}

/** A header group's validator, with every other header in it given a value it accepts. */
function accepts(group: string, name: string, value: string): boolean {
	const valid: Record<string, Record<string, string>> = {
		requestHeader: {
			value: HTTP_DATE,
			offset: HTTP_DATE,
			nullable: RFC_3339,
			explicit: HTTP_DATE,
			instant: RFC_3339,
			stamp: RFC_3339,
			list: RFC_3339,
		},
		responseResponse204Headers: { value: HTTP_DATE, instant: RFC_3339 },
	};
	return schemas[group]?.safeParse({ ...valid[group], [name]: value }).success ?? false;
}

describe("a date-time header with no @encode", () => {
	it("compiles without a diagnostic", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	it("is a string on the wire, as the explicit rfc7231 encoding already was", () => {
		const header =
			/export const requestHeader = z\.object\(\{([\s\S]*?)\n\}\);/.exec(source)?.[1] ?? "";
		expect(header).toContain("\tvalue: z.string(),");
		expect(header).toContain("\toffset: z.string(),");
		expect(header).toContain("\toptional: z.string().exactOptional(),");
		expect(header).toContain("\texplicit: z.string(),");
		expect(header).toContain("\tinstant: z.iso.datetime({ offset: true }),");
		expect(header).toContain("\tstamp: z.iso.datetime({ offset: true }),");
	});

	for (const version of GRADED_OPENAPI_VERSIONS) {
		it(`accepts an HTTP-date exactly where the ${version} document publishes one`, () => {
			const rows = headersOf(documents[version] as Document);
			// Non-vacuity: both formats are published, on requests and on responses.
			expect(rows.filter(([, , format]) => format === "http-date").length).toBe(5);
			expect(rows.filter(([, , format]) => format === "date-time").length).toBe(5);
			for (const [group, name, format] of rows) {
				expect(accepts(group, name, HTTP_DATE), `${group}.${name} (${format})`).toBe(
					format === "http-date",
				);
			}
		});
	}

	it("still accepts RFC 3339 where the document says date-time", () => {
		for (const [group, name] of [
			["requestHeader", "instant"],
			["requestHeader", "stamp"],
			["requestHeader", "list"],
			["requestHeader", "nullable"],
			["responseResponse204Headers", "instant"],
		] as const) {
			expect(accepts(group, name, RFC_3339), `${group}.${name}`).toBe(true);
		}
	});

	it("typechecks, the contracts and their agreement assertions included", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
