import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllHttpServices } from "@typespec/http";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { collectRoutes, type EmittedRoute } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **An `@encode`d list parameter is decoded by the same rule its schema is built by.** See
 * `encodedlists.tsp`.
 *
 * `encodedTypeOf` is that rule: an array encoding on a query parameter is a style and the declared
 * list stays; any other `@encode` makes the wire type the type it states. The schema walk followed
 * it, while the split, the element decoder and the path expansion each read `@encode` their own way.
 * So a header or path list was split into an array and handed to `z.string()`, a custom-encoded query
 * list likewise, and a pipe-delimited list of numbers was split but never decoded: four of the five
 * shapes refused every request (typespec-http-graphql, 2026-10-16).
 *
 * **The document is the oracle.** Each parameter's schema is pinned as openapi3 publishes it, the
 * REST form is parsed through the emitted validator, and the decoded value is then validated against
 * that published schema.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let routes: readonly EmittedRoute[];
let parameters: Record<string, { name: string; in: string; schema: Record<string, unknown> }>;
let components: Record<string, unknown>;
const ajv = new Ajv2020.default({ strict: false, validateFormats: false });

beforeAll(async () => {
	compiled = await compileFixture(here, "encodedlists", { outName: "encodedlists" });
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	const [[service]] = getAllHttpServices(compiled.program);
	if (service === undefined) throw new Error("no service");
	routes = collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service);
	const [record] = await getOpenAPI3(compiled.program, { "openapi-versions": ["3.1.0"] });
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as {
		components: { schemas: Record<string, unknown> };
		paths: Record<
			string,
			{ get: { parameters: { name: string; in: string; schema: Record<string, unknown> }[] } }
		>;
	};
	components = document.components.schemas;
	parameters = Object.fromEntries(
		Object.entries(document.paths).map(([path, item]) => [path, item.get.parameters[0]!]),
	);
}, 300_000);

/** operation, its path in the document, the validator export, the wire key, the REST form, the value. */
const CASES: readonly (readonly [string, string, string, string, string, unknown])[] = [
	["Q", "/q", "Q_readQuery", "ids", "1|2", [1, 2]],
	["P", "/p/{ids}", "P_readPath", "ids", "a,b", "a,b"],
	["H", "/h", "H_readHeader", "x-tags", "a,b", "a,b"],
	["C", "/c", "C_readQuery", "tags", "a,b", "a,b"],
	["S", "/s", "S_readQuery", "tags", "a,b", ["a", "b"]],
];

describe("what the document publishes for each parameter", () => {
	/**
	 * Pinned, because these are the oracle column of the report: if openapi3 stopped keeping a
	 * style-encoded query list as a list, the rows below would grade against a rule it no longer follows.
	 */
	it("keeps a style-encoded query list as a list, and makes every other encoding its wire type", () => {
		expect(parameters["/q"]).toMatchObject({
			in: "query",
			style: "pipeDelimited",
			schema: { type: "array", items: { type: "integer", format: "int32" } },
		});
		expect(parameters["/p/{ids}"]).toMatchObject({
			in: "path",
			schema: { type: "string", format: "ArrayEncoding.commaDelimited" },
		});
		expect(parameters["/h"]).toMatchObject({
			in: "header",
			schema: { type: "string", format: "ArrayEncoding.commaDelimited" },
		});
		expect(parameters["/c"]).toMatchObject({
			in: "query",
			schema: { type: "string", format: "x-custom" },
		});
		expect(parameters["/s"]).toMatchObject({
			in: "query",
			style: "commaDelimited",
			schema: { type: "array", items: { type: "string" } },
		});
	});
});

describe("each encoded list, sent as its REST form", () => {
	it("compiles without a diagnostic", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	for (const [operation, path, exported, key, wire, value] of CASES) {
		it(`${operation}: decodes ${JSON.stringify(wire)} to ${JSON.stringify(value)}, which the document's schema accepts`, () => {
			const result = schemas[exported]?.safeParse({ [key]: wire });
			expect(result?.error?.issues).toBeUndefined();
			expect(result?.data).toEqual({ [key]: value });
			const parameter = parameters[path];
			expect(parameter?.name).toBe(key);
			expect(ajv.validate(parameter?.schema ?? false, value)).toBe(true);
		});
	}

	/**
	 * **Inside a form-exploded query model, too.** The gatherer decoded each property's text by its
	 * declared type, so `@encode(string) count: int32` became the number 5 and then met `z.string()`.
	 */
	it("M: keeps an encoded property of an exploded model as its wire string, and decodes the rest", () => {
		const result = schemas["M_readQuery"]?.safeParse({ count: "5", flag: "true" });
		expect(result?.error?.issues).toBeUndefined();
		expect(result?.data).toEqual({ filter: { count: "5", flag: true } });
		expect(parameters["/m"]).toMatchObject({
			in: "query",
			schema: { $ref: "#/components/schemas/Filter" },
		});
		expect(
			ajv.validate(
				{ $ref: "#/components/schemas/Filter", components: { schemas: components } },
				result?.data?.["filter" as never],
			),
		).toBe(true);
	});

	/**
	 * **A path parameter whose segment is its value is not decoded, so the route says so.**
	 * `decodedPathParameters` is what typespec-http-mcp reads to choose a tool argument's schema; it is
	 * decided by the same rule as the validator, so it moves with it.
	 */
	it("P: validates the segment text as the value, and the route does not list it as decoded", () => {
		expect(routes.find((route) => route.operationId === "P_read")?.decodedPathParameters).toEqual(
			[],
		);
	});
});

describe("the input each handler receives", () => {
	it("is typed as the decoded value", () => {
		const file = join(compiled.outDir, "consumer.ts");
		writeFileSync(
			file,
			`import type { WireInputs } from "./requests.gen.js";

type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;
export type Q = MustHold<Identical<WireInputs["Q_read"], { ids: number[] }>>;
export type P = MustHold<Identical<WireInputs["P_read"], { ids: string }>>;
export type H = MustHold<Identical<WireInputs["H_read"], { "x-tags": string }>>;
export type C = MustHold<Identical<WireInputs["C_read"], { tags: string }>>;
export type S = MustHold<Identical<WireInputs["S_read"], { tags: string[] }>>;
`,
		);
		try {
			const { output, failed } = typecheckEmitted(compiled.outDir);
			expect(output).toBe("");
			expect(failed).toBe(false);
		} finally {
			rmSync(file, { force: true });
		}
	});
});
