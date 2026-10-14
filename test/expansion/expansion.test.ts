import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllHttpServices } from "@typespec/http";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { collectRoutes, type EmittedRoute } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A path or query value arrives as the text its RFC 6570 expression expanded to, and is decoded
 * back into the value the document describes before it is validated.**
 *
 * `@typespec/http-specs` `routes` documents each form with one value and the exact URI its mock
 * server expects: `/routes/path/label/explode/array.a.b` for `["a", "b"]` under `array{.param*}`. A
 * router can only hand over the segment an expression sits in, `array.a.b`, so that is what each arm
 * feeds. Before this, a path list was never split, a record was never paired, a form-exploded
 * record or model was never gathered, and typespec-hono answered 404 or 400 to 34 such requests.
 *
 * **The expectations are the mock's URIs and the scenario's documented values**, written out below;
 * nothing is derived from `src/`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let routes: readonly EmittedRoute[];

beforeAll(async () => {
	compiled = await compileFixture(here, "expansion");
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	const [[service]] = getAllHttpServices(compiled.program);
	if (service === undefined) throw new Error("no service");
	routes = collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service);
}, 120_000);

const parsed = (schema: string, value: Record<string, unknown>) => {
	const result = schemas[schema]?.safeParse(value);
	if (result === undefined) throw new Error(`no schema ${schema}`);
	return result;
};

const A = "a";
const AB = ["a", "b"];
const RECORD = { a: 1, b: 2 };

/** operation, the one segment its expression sits in (as the mock URI spells it), the documented value. */
const PATH_CASES: readonly (readonly [string, string, unknown])[] = [
	["simplePrimitive", "primitivea", A],
	["simpleArray", "arraya,b", AB],
	["simpleRecord", "recorda,1,b,2", RECORD],
	["simpleExplodeArray", "arraya,b", AB],
	["simpleExplodeRecord", "recorda=1,b=2", RECORD],
	["pathPrimitive", "a", A],
	["pathArray", "a,b", AB],
	["pathRecord", "a,1,b,2", RECORD],
	// A `{/x*}` expansion spans segments, so a router hands over everything after the literal.
	["pathExplodeArray", "a/b", AB],
	["pathExplodeRecord", "a=1/b=2", RECORD],
	["labelPrimitive", "primitive.a", A],
	["labelArray", "array.a,b", AB],
	["labelRecord", "record.a,1,b,2", RECORD],
	["labelExplodeArray", "array.a.b", AB],
	["labelExplodeRecord", "record.a=1.b=2", RECORD],
	["matrixPrimitive", "primitive;param=a", A],
	["matrixArray", "array;param=a,b", AB],
	["matrixRecord", "record;param=a,1,b,2", RECORD],
	["matrixExplodeArray", "array;param=a;param=b", AB],
	["matrixExplodeRecord", "record;a=1;b=2", RECORD],
	["labelNumber", "versions.3", 3],
];

describe("a path value is decoded from the text its expression expanded to", () => {
	it("compiles without an error, and emits a path validator for every case", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		for (const [operation] of PATH_CASES)
			expect(schemas[`${operation}Path`], operation).toBeDefined();
	});

	for (const [operation, segment, value] of PATH_CASES) {
		it(`${operation}: "${segment}" is ${JSON.stringify(value)}`, () => {
			const name = operation === "labelNumber" ? "version" : "param";
			const result = parsed(`${operation}Path`, { [name]: segment });
			expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
			expect(result.data).toEqual({ [name]: value });
		});
	}

	it("refuses text that is not the expansion the route declares", () => {
		// The operator is missing, the literal is wrong, or a pair is incomplete.
		expect(parsed("labelArrayPath", { param: "arraya,b" }).success).toBe(false);
		expect(parsed("matrixPrimitivePath", { param: "primitive;other=a" }).success).toBe(false);
		expect(parsed("simpleRecordPath", { param: "recorda,1,b" }).success).toBe(false);
		expect(parsed("labelNumberPath", { version: "versions.three" }).success).toBe(false);
	});

	it("control: an ordinary whole-segment parameter is left exactly as it was", () => {
		expect(parsed("plainPath", { id: "x" }).data).toEqual({ id: "x" });
	});
});

/**
 * **A caller holding the VALUE validates against the value schema, and the route says which
 * parameters that differs for.** A tool call carries `{ param: "a" }`, not the segment text; through
 * the decoder that value is refused for `{.param}`, and `"primitivex"` under `primitive{param}` is
 * rewritten to `"x"`. `typespec-http-mcp` spread the path validator's shape into a tool's arguments
 * and met exactly that (its issue #1), so the fact is published rather than re-derived downstream.
 */
describe("the route names the path parameters it decodes", () => {
	const decoded = (operation: string) =>
		routes.find((route) => route.operationId === operation)?.decodedPathParameters;
	const field = (operation: string, name: string) =>
		(
			schemas[`${operation}Path`] as unknown as {
				shape: Record<string, ZodType & { out?: ZodType }>;
			}
		).shape[name];

	it("lists exactly the parameters whose segment is decoded", () => {
		const listed = PATH_CASES.filter(([operation]) => (decoded(operation) ?? []).length > 0).map(
			([operation]) => operation,
		);
		// `{/param}` and `{param}` over a whole segment hand over the value itself.
		expect(PATH_CASES.map(([operation]) => operation).filter((op) => !listed.includes(op))).toEqual(
			["pathPrimitive"],
		);
		expect(decoded("plain")).toEqual([]);
		expect(decoded("labelNumber")).toEqual(["version"]);
	});

	for (const [operation, , value] of PATH_CASES) {
		it(`${operation}: the value ${JSON.stringify(value)} passes the schema a value-holder validates against`, () => {
			const name = operation === "labelNumber" ? "version" : "param";
			const schema = (decoded(operation) ?? []).includes(name)
				? field(operation, name)?.out
				: field(operation, name);
			const result = schema?.safeParse(value);
			expect(result?.success, JSON.stringify(result?.error?.issues)).toBe(true);
			expect(result?.data).toEqual(value);
		});
	}

	it("rewrites nothing a value-holder sends, where the decoder would", () => {
		expect(field("simplePrimitive", "param")?.parse("primitiveprimitivex")).toBe("primitivex");
		expect(field("simplePrimitive", "param")?.out?.parse("primitivex")).toBe("primitivex");
	});
});

describe("a query value is decoded from its form expansion", () => {
	it("pairs an unexploded record: ?param=a,1,b,2", () => {
		expect(parsed("queryRecordQuery", { param: "a,1,b,2" }).data).toEqual({ param: RECORD });
	});

	it("gathers an exploded record from the keys it expanded to: ?a=1&b=2", () => {
		expect(parsed("queryExplodeRecordQuery", { a: "1", b: "2" }).data).toEqual({ param: RECORD });
	});

	/**
	 * **A record's key may be the parameter's own name.** `{ param: 0 }` expands to `?param=0`, which
	 * a gatherer that took any `param` key as an already-gathered object left in place, and the record
	 * schema then refused the string. A query value from the wire is a string or a list of them, never
	 * an object, so only an object under the name is already gathered.
	 */
	it("gathers an exploded record whose key is the parameter's own name: ?param=0", () => {
		expect(parsed("queryExplodeRecordQuery", { param: "0" }).data).toEqual({
			param: { param: 0 },
		});
		expect(parsed("continuationRecordQuery", { fixed: "true", param: "0" }).data).toEqual({
			param: { param: 0 },
		});
	});

	it("control: a query already gathered under the parameter's name is left as it is", () => {
		expect(parsed("queryExplodeRecordQuery", { param: { a: 1 } }).data).toEqual({
			param: { a: 1 },
		});
	});

	it("gathers an exploded model from its own property names: ?field=status&value=active", () => {
		expect(parsed("queryExplodeModelQuery", { field: "status", value: "active" }).data).toEqual({
			param: { field: "status", value: "active" },
		});
	});

	it("leaves the route's own literal query out of an exploded record: ?fixed=true&a=1&b=2", () => {
		// `fixed` stays a key of its own, which the query object does not declare and so does not keep.
		expect(parsed("continuationRecordQuery", { fixed: "true", a: "1", b: "2" }).data).toEqual({
			param: RECORD,
		});
	});

	it("still refuses what the document refuses once gathered", () => {
		expect(parsed("queryExplodeRecordQuery", { a: "one" }).success).toBe(false);
		expect(parsed("queryExplodeModelQuery", { field: "status" }).success).toBe(false);
	});

	/**
	 * **A gathered group is a pipe, and a pipe has no `.shape`.** A consumer that builds arguments from
	 * already-structured JSON (typespec-http-mcp spreads each group's `.shape`) needs the object itself,
	 * so it is declared on its own and the wire validator wraps it. Measured before: the MCP corpus
	 * typecheck failed on `routes` with `Property 'shape' does not exist on type 'ZodPreprocess<...>'`.
	 */
	it("declares a gathered query object on its own, with the shape a consumer can spread", () => {
		const fields = schemas["queryExplodeRecordQueryFields"] as unknown as {
			shape?: Record<string, unknown>;
		};
		expect(Object.keys(fields?.shape ?? {})).toEqual(["param"]);
		expect(parsed("queryExplodeRecordQueryFields", { param: { a: 1 } }).success).toBe(true);
		// Only where something is gathered: an ordinary group is not declared twice.
		expect(schemas["plainQueryFields"]).toBeUndefined();
	});

	it("control: an ordinary query list still splits on its delimiter", () => {
		expect(parsed("plainQuery", { tags: "a,b" }).data).toEqual({ tags: AB });
	});
});

describe("the route says how a server mounts each expression", () => {
	const route = (operationId: string) => {
		const found = routes.find((candidate) => candidate.operationId === operationId);
		if (found === undefined) throw new Error(`no route ${operationId}`);
		return found;
	};

	it("splits the template into literal segments and one expression per segment, with its operator", () => {
		expect(route("labelExplodeArray").pathSegments).toEqual([
			{ kind: "literal", text: "label" },
			{ kind: "literal", text: "explode" },
			{
				kind: "expression",
				parameter: "param",
				prefix: "array",
				suffix: "",
				operator: ".",
				explode: true,
				optional: false,
				reserved: false,
			},
		]);
		expect(route("pathExplodeRecord").pathSegments.at(-1)).toEqual({
			kind: "expression",
			parameter: "param",
			prefix: "",
			suffix: "",
			operator: "/",
			explode: true,
			optional: false,
			reserved: false,
		});
		expect(route("plain").pathSegments).toEqual([
			{ kind: "literal", text: "plain" },
			{
				kind: "expression",
				parameter: "id",
				prefix: "",
				suffix: "",
				operator: "",
				explode: false,
				optional: false,
				reserved: false,
			},
		]);
	});

	it("carries a literal query string as the pairs it spells, and keeps it out of the path", () => {
		expect(route("continuation").literalQuery).toEqual([["fixed", "true"]]);
		expect(route("continuation").pathSegments).toEqual([
			{ kind: "literal", text: "continuation" },
			{ kind: "literal", text: "primitive" },
		]);
		expect(route("plain").literalQuery).toEqual([]);
	});
});
