import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A parameter's text is read as the value its schema says it is.** See `readers.tsp`.
 *
 * A path, query, header or cookie value is always text, and the document's schema describes it read.
 * The validator read it by a kind decided from the type - a number, a boolean, or text - so a numeric
 * enum, `int32 | boolean` and `int32 | "all"` were never read and refused every value; a record or a
 * model in a header or a cookie was not read at all, a model's values in a query were left as text,
 * and an exploded header list was boxed whole. Each row is graded by Ajv against the parameter's own
 * schema in the document, with the value the text spells.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let parameterOf: (path: string, location: string, name: string) => unknown;
const ajv = new Ajv2020.default({ strict: false, validateFormats: false });

beforeAll(async () => {
	compiled = await compileFixture(here, "readers", { outName: "readers" });
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		"seal-object-schemas": true,
	});
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as {
		paths: Record<string, { get: { parameters: { in: string; name: string; schema: unknown }[] } }>;
		components?: unknown;
	};
	parameterOf = (path, location, name) => {
		const schema = document.paths[path]?.get.parameters.find(
			(parameter) => parameter.in === location && parameter.name === name,
		)?.schema;
		return schema === undefined
			? undefined
			: { ...(schema as object), components: document.components };
	};
}, 300_000);

type Row = readonly [
	op: string,
	path: string,
	location: string,
	name: string,
	wire: string,
	value: unknown,
];

/** The text sent, and the value it spells - what the document's schema is asked about. */
const ROWS: readonly Row[] = [
	["q", "/q", "query", "n", "5", 5],
	["q", "/q", "query", "n", "x", "x"],
	["q", "/q", "query", "b", "true", true],
	["q", "/q", "query", "e", "a", "a"],
	["q", "/q", "query", "e", "z", "z"],
	["q", "/q", "query", "ne", "1", 1],
	["q", "/q", "query", "ne", "3", 3],
	["q", "/q", "query", "neBare", "1", 1],
	["q", "/q", "query", "lit", "x", "x"],
	["q", "/q", "query", "nlit", "1", 1],
	["q", "/q", "query", "nlit", "3", 3],
	["q", "/q", "query", "blit", "true", true],
	["q", "/q", "query", "blit", "false", false],
	["q", "/q", "query", "ts", "5", 5],
	["q", "/q", "query", "mi", "5", 5],
	["q", "/q", "query", "ib", "5", 5],
	["q", "/q", "query", "ib", "true", true],
	["q", "/q", "query", "ib", "x", "x"],
	["q", "/q", "query", "inum", "5", 5],
	["q", "/q", "query", "limit", "5", 5],
	["q", "/q", "query", "limit", "all", "all"],
	["q", "/q", "query", "limit", "some", "some"],
	["q", "/q", "query", "either", "300", "300"],
	["q", "/q", "query", "either", "5", 5],
	["q", "/q", "query", "arrNum", "1,2", [1, 2]],
	["q", "/q", "query", "arrNum", "1,3", [1, 3]],
	["q", "/q", "query", "rec", "a,1,b,2", { a: 1, b: 2 }],
	["q", "/q", "query", "rec", "a,x", { a: "x" }],
	["q", "/q", "query", "fields", "a,1,b,x", { a: 1, b: "x" }],
	["q", "/q", "query", "fields", "a,x", { a: "x" }],
	["h", "/h", "header", "n", "5", 5],
	["h", "/h", "header", "ne", "1", 1],
	["h", "/h", "header", "nlit", "1", 1],
	["h", "/h", "header", "mi", "5", 5],
	["h", "/h", "header", "ids", "1,2", [1, 2]],
	["h", "/h", "header", "ids", "1", [1]],
	["h", "/h", "header", "rec", "a,1,b,2", { a: 1, b: 2 }],
	["h", "/h", "header", "rec", "a,x", { a: "x" }],
	["h", "/h", "header", "recx", "a=1,b=2", { a: 1, b: 2 }],
	["c", "/c", "cookie", "n", "5", 5],
	["c", "/c", "cookie", "ne", "1", 1],
	["c", "/c", "cookie", "mi", "5", 5],
	["c", "/c", "cookie", "ids", "1,2", [1, 2]],
	["c", "/c", "cookie", "rec", "a,1,b,2", { a: 1, b: 2 }],
	["c", "/c", "cookie", "rec", "a,x", { a: "x" }],
	["c", "/c", "cookie", "fields", "a,1,b,x", { a: 1, b: "x" }],
	["p", "/p/{n}/{ne}/{mi}/{rec}", "path", "n", "5", 5],
	["p", "/p/{n}/{ne}/{mi}/{rec}", "path", "ne", "1", 1],
	["p", "/p/{n}/{ne}/{mi}/{rec}", "path", "mi", "5", 5],
	["p", "/p/{n}/{ne}/{mi}/{rec}", "path", "rec", "a,1,b,2", { a: 1, b: 2 }],
	["p", "/p/{n}/{ne}/{mi}/{rec}", "path", "rec", "a,x", { a: "x" }],
];

const PATH = { n: "5", ne: "1", mi: "5", rec: "a,1" };
const exportOf = (op: string, location: string): string =>
	`${op}${location[0]?.toUpperCase()}${location.slice(1)}`;

describe("a parameter's text, read as its schema says", () => {
	it("compiles without a diagnostic", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	for (const [op, path, location, name, wire, value] of ROWS) {
		it(`${location} ${name} ${JSON.stringify(wire)}: answers as the document does`, () => {
			const schema = parameterOf(path, location, name);
			expect(schema, `${location} ${name} in the document`).toBeDefined();
			const input = location === "path" ? { ...PATH, [name]: wire } : { [name]: wire };
			const parsed = schemas[exportOf(op, location)]?.safeParse(input);
			expect(parsed, exportOf(op, location)).toBeDefined();
			// Judged by this parameter's own issues, so another parameter's verdict cannot leak in.
			const accepted =
				parsed?.success === true ||
				!(parsed?.error?.issues ?? []).some((issue) => issue.path[0] === name);
			expect(accepted).toBe(ajv.validate(schema as object, value));
			if (parsed?.success === true)
				expect((parsed.data as Record<string, unknown>)[name]).toEqual(value);
		});
	}

	it("gathers an exploded model, each key read as its property says", () => {
		const query = schemas["qQuery"] as ZodType;
		expect(query.parse({ qa: "1", qb: "true", qn: "1" })).toEqual({
			qf: { qa: 1, qb: true, qn: 1 },
		});
		expect(query.safeParse({ qn: "3" }).success).toBe(false);
	});

	it("emits a set that compiles, an operation id closing a comment included", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});

/**
 * **Where a text has more than one reading, the one the document's schema accepts.** See
 * `readers2.tsp`. A number is text in JSON's number grammar: read by `Number()`, `"0x10"` was `16` and
 * `"007" | int32` turned the `"007"` it accepts into `7`. A union of a scalar and a list or a model is
 * read each way its style allows. A record's or a model's reader is looked up as its own key, so
 * `constructor` threw no more, and a model with an indexer reads its declared keys as they say. A
 * list in an exploded model is boxed and read; a label expansion's value may hold its `.`; an
 * exploded model leaves another parameter its key; and a default its own keyword refuses is dropped.
 */
describe("a parameter's text, where a reading is not the only one", () => {
	let second: CompiledFixture;
	let modules: Record<string, ZodType>;
	let schemaOf: (path: string, location: string, name: string) => unknown;

	beforeAll(async () => {
		second = await compileFixture(here, "readers2", { outName: "readers2" });
		modules = (await import(join(second.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
		const [record] = await getOpenAPI3(second.program, {
			"openapi-versions": ["3.1.0"],
			"seal-object-schemas": true,
		});
		const document = JSON.parse(
			JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
		) as {
			paths: Record<
				string,
				{ get: { parameters: { in: string; name: string; schema: unknown }[] } }
			>;
			components?: unknown;
		};
		schemaOf = (path, location, name) => {
			const key = Object.keys(document.paths).find((each) => each.startsWith(path));
			const schema = document.paths[key ?? ""]?.get.parameters.find(
				(parameter) => parameter.in === location && parameter.name === name,
			)?.schema;
			return schema === undefined
				? undefined
				: { ...(schema as object), components: document.components };
		};
	}, 300_000);

	type Reading = readonly [
		op: string,
		path: string,
		location: string,
		name: string,
		wire: string,
		value: unknown,
	];
	const READINGS: readonly Reading[] = [
		["q", "/q", "query", "i", "0x10", "0x10"],
		["q", "/q", "query", "i", "007", "007"],
		["q", "/q", "query", "i", " 5", " 5"],
		["q", "/q", "query", "i", "1e3", 1000],
		["q", "/q", "query", "lit", "007", "007"],
		["q", "/q", "query", "zip", "01234", "01234"],
		["q", "/q", "query", "zero", "0x10", "0x10"],
		["q", "/q", "query", "lsi", "a,007", ["a", "007"]],
		["q", "/q", "query", "il", "a,b", ["a", "b"]],
		["q", "/q", "query", "il", "5", 5],
		["q", "/q", "query", "im", "a,1", { a: 1 }],
		["q", "/q", "query", "im", "5", 5],
		["q", "/q", "query", "m", "a,1,constructor,2", { a: 1, constructor: "2" }],
		["q", "/q", "query", "m", "a,1,__proto__,2", { a: 1, ["__proto__"]: "2" }],
		["q", "/q", "query", "mr", "s,5", { s: "5" }],
		["q", "/q", "query", "mr", "k,1", { k: "1" }],
		["q", "/q", "query", "xp", "1|2", [1, 2]],
		["h", "/h", "header", "m", "a,1,toString,2", { a: 1, toString: "2" }],
		["h", "/h", "header", "hzip", "01234", "01234"],
		["c", "/c", "cookie", "m", "a,1,valueOf,2", { a: 1, valueOf: "2" }],
		["f7", "/f7", "path", "r", "f7.a=1.5", { a: 1.5 }],
		["f7", "/f7", "path", "r", "f7.a=1.5.b=2", { a: 1.5, b: 2 }],
	];

	for (const [op, path, location, name, wire, value] of READINGS) {
		it(`${location} ${name} ${JSON.stringify(wire)}: answers as the document does, and throws nothing`, () => {
			const schema = schemaOf(path, location, name);
			expect(schema, `${location} ${name} in the document`).toBeDefined();
			const validator = modules[exportOf(op, location)];
			expect(validator, exportOf(op, location)).toBeDefined();
			const parsed = (validator as ZodType).safeParse({ [name]: wire });
			const accepted =
				parsed.success || !parsed.error.issues.some((issue) => issue.path[0] === name);
			const verdict = ajv.validate(schema as object, value);
			expect(accepted, `${name} = ${JSON.stringify(wire)}`).toBe(verdict);
			if (parsed.success) expect((parsed.data as Record<string, unknown>)[name]).toEqual(value);
		});
	}

	it("gathers an exploded model's keys as they say, a key named on Object.prototype included", () => {
		expect(modules["xQuery"]?.parse({ a: "1", constructor: "2" })).toEqual({
			mi: { a: 1, constructor: 2 },
		});
		expect(modules["tQuery"]?.parse({ tags: ["1", "2"] })).toEqual({ tags: { tags: [1, 2] } });
		expect(modules["tQuery"]?.parse({ tags: "1" })).toEqual({ tags: { tags: [1] } });
		// `a` is the query parameter's, as the document reads `?a=x`, and not the exploded model's.
		expect(modules["oQuery"]?.parse({ a: "x" })).toEqual({ a: "x" });
	});

	it("drops, and reports, a default its own keyword refuses", () => {
		expect(second.diagnostics).toEqual(
			Array.from({ length: 3 }, () => ({
				code: "typespec-http-zod/invalid-default",
				severity: "warning",
			})),
		);
		expect(modules["dQuery"]?.parse({})).toEqual({});
	});

	it("emits a set that compiles", () => {
		const { output, failed } = typecheckEmitted(second.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});

describe("a tuple parameter", () => {
	it("is refused once, saying why", async () => {
		const compiled = await compileFixture(here, "tuple", { outName: "tuple" });
		expect(compiled.diagnostics).toEqual([
			{ code: "typespec-http-zod/unsupported-type", severity: "error" },
		]);
		expect(compiled.program.diagnostics[0]?.message).toContain("prefixItems");
	}, 300_000);
});
