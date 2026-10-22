import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { getSourceLocation } from "@typespec/compiler";
import { getAllHttpServices } from "@typespec/http";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { collectRoutes, type EmittedRoute } from "../../../src/index.js";
import { SchemaRegistry } from "../../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../../support/compile-fixture.js";
import { typecheckEmitted } from "../../support/typecheck-emitted.js";

/**
 * **Reading parameters from the wire, each held to the document.** Every fixture is compiled
 * sealed and open, and a parameter's validator is given the wire as a server hands it over - a
 * query object, a segment's text - and graded by Ajv on the parameter schema openapi3 publishes
 * from the same program. The readings of each wire value are written out here, as
 * every JSON value its text can spell: the document accepts the wire where one of them is valid, and
 * the validator has to accept exactly then and hand on one of the readings the document accepts.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

interface DocumentParameter {
	readonly name: string;
	readonly in: string;
	readonly required?: boolean;
	readonly style?: string;
	readonly explode?: boolean;
	readonly schema: unknown;
}

interface Document {
	readonly paths: Record<string, Record<string, { parameters?: unknown[] }>>;
	readonly components?: { parameters?: Record<string, DocumentParameter> };
}

interface Loaded {
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
	readonly document: Document;
	/** openapi3's own diagnostics, as `severity code`. */
	readonly documentDiagnostics: readonly string[];
}

const loaded = new Map<string, Loaded>();

async function load(name: string, sealed: boolean): Promise<Loaded> {
	const compiled = await compileFixture(here, name, {
		outName: `${name}-${sealed ? "sealed" : "open"}`,
		extraOptions: { "seal-object-schemas": sealed },
	});
	const schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
		string,
		ZodType
	>;
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		"seal-object-schemas": sealed,
	});
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as Document;
	const documentDiagnostics =
		record !== undefined && !record.versioned
			? record.diagnostics.map((d) => `${d.severity} ${d.code}`)
			: [];
	return { compiled, schemas, document, documentDiagnostics };
}

const fixtures = readdirSync(here)
	.filter((file) => file.endsWith(".tsp"))
	.map((file) => file.slice(0, -".tsp".length));

beforeAll(async () => {
	for (const name of fixtures) {
		for (const sealed of [true, false]) loaded.set(`${name}:${sealed}`, await load(name, sealed));
	}
}, 900_000);

const of = (name: string, sealed = true): Loaded => {
	const found = loaded.get(`${name}:${sealed}`);
	if (found === undefined) throw new Error(`no fixture ${name}`);
	return found;
};

/** This emitter's errors and warnings, as `severity code`; the compiler's own left out. */
const ours = (name: string, sealed = true): string[] =>
	of(name, sealed)
		.compiled.program.diagnostics.filter((d) => d.code.startsWith("typespec-http-zod/"))
		.map((d) => `${d.severity} ${d.code.slice("typespec-http-zod/".length)}`)
		.toSorted();

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Every JSON value one piece of wire text spells: the number, the boolean, the text itself. */
const spelled = (text: string): unknown[] => [
	...(NUMBER.test(text) ? [Number(text)] : []),
	...(text === "true" || text === "false" ? [text === "true"] : []),
	text,
];

/** Every list a run of wire texts spells, one reading per element. */
const listsOf = (...texts: readonly string[]): unknown[][] =>
	texts.reduce<unknown[][]>(
		(all, text) => all.flatMap((prefix) => spelled(text).map((value) => [...prefix, value])),
		[[]],
	);

/** Every object a set of keys and their texts spells, a repeated key as a list of them. */
const objectsOf = (
	entries: Readonly<Record<string, string | readonly string[]>>,
): Record<string, unknown>[] =>
	Object.entries(entries).reduce<Record<string, unknown>[]>(
		(all, [key, text]) =>
			all.flatMap((prefix) =>
				(typeof text === "string" ? spelled(text) : listsOf(...text)).map((value) => {
					const next = { ...prefix };
					Object.defineProperty(next, key, {
						value,
						enumerable: true,
						writable: true,
						configurable: true,
					});
					return next;
				}),
			),
		[{}],
	);

/** The parameter the document publishes at a path, location and name, its reference followed. */
function documentParameter(
	fixture: Loaded,
	path: string,
	location: string,
	name: string,
): DocumentParameter | undefined {
	const parameters = (fixture.document.paths[path]?.["get"]?.parameters ?? []).map((each) => {
		const reference = (each as { $ref?: string }).$ref;
		return reference === undefined
			? (each as DocumentParameter)
			: fixture.document.components?.parameters?.[
					decodeURIComponent(reference.split("/").at(-1) ?? "")
				];
	});
	return parameters.find((each) => each?.in === location && each.name === name);
}

/** One wire value, and every reading of it the document could take - `undefined` for "not sent". */
type Case = readonly [input: Record<string, unknown>, readings: readonly unknown[]];

/**
 * Each case graded on the document and on the validator, sealed and open: the validator accepts
 * exactly where the document accepts a reading, and its value for the parameter is one of those.
 */
function graded(
	name: string,
	exported: string,
	where: { readonly path: string; readonly location: string; readonly name: string },
	cases: readonly Case[],
): void {
	for (const sealed of [true, false]) {
		const fixture = of(name, sealed);
		const parameter = documentParameter(fixture, where.path, where.location, where.name);
		expect(parameter, `${name} publishes ${where.location} ${where.name}`).toBeDefined();
		const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
		const validate = ajv.compile({
			...(parameter?.schema as object),
			components: fixture.document.components,
		});
		const schema = fixture.schemas[exported];
		expect(schema, `${name} ${exported}`).toBeDefined();
		for (const [input, readings] of cases) {
			const accepted = readings.filter((reading) =>
				reading === undefined ? parameter?.required !== true : validate(reading),
			);
			const result = schema?.safeParse(input);
			const label = `${name} sealed=${sealed} ${exported} ${JSON.stringify(input)}`;
			expect(result?.success, `${label}: ${JSON.stringify(result?.error?.issues)}`).toBe(
				accepted.length > 0,
			);
			if (result?.success !== true) continue;
			const value = (result.data as Record<string, unknown>)[where.name];
			expect(
				accepted.some((reading) => isDeepStrictEqual(reading, value)),
				`${label} read as ${JSON.stringify(value)}, the document reads ${JSON.stringify(accepted)}`,
			).toBe(true);
		}
	}
}

describe("every parameter fixture's emitted set", () => {
	it("loads and typechecks, the wire contract included, sealed and open", () => {
		for (const name of fixtures) {
			for (const sealed of [true, false]) {
				const { output, failed } = typecheckEmitted(of(name, sealed).compiled.outDir);
				expect(output, `${name} sealed=${sealed}`).toBe("");
				expect(failed, `${name} sealed=${sealed}`).toBe(false);
			}
		}
	});
});

describe("a form-exploded query of a list or a scalar beside a record or a model", () => {
	const at = (path: string) => ({ path, location: "query", name: "x" });

	it("reads a repeated key as the list, and a lone one as the value it may be", () => {
		graded("f6-list-record", "aQuery", at("/a"), [
			[{ x: ["1", "2"] }, [...listsOf("1", "2"), ...objectsOf({ x: ["1", "2"] })]],
			[{ x: "5" }, [...listsOf("5"), ...objectsOf({ x: "5" })]],
			[{ x: "007" }, [...listsOf("007"), ...objectsOf({ x: "007" })]],
			[{ x: ["x", "y"] }, [...listsOf("x", "y"), ...objectsOf({ x: ["x", "y"] })]],
			[{ a: "1", b: "2" }, objectsOf({ a: "1", b: "2" })],
			[{ a: "x" }, objectsOf({ a: "x" })],
		]);
		graded("f6-list-record", "bQuery", at("/b"), [
			[{ x: ["1", "2"] }, [...objectsOf({ x: ["1", "2"] }), ...listsOf("1", "2")]],
			[{ x: "5" }, [...objectsOf({ x: "5" }), ...listsOf("5")]],
			[{ x: "007" }, [...objectsOf({ x: "007" }), ...listsOf("007")]],
			[{ x: "x" }, [...objectsOf({ x: "x" }), ...listsOf("x")]],
			[{ x: ["x", "y"] }, [...objectsOf({ x: ["x", "y"] }), ...listsOf("x", "y")]],
			[{ a: "1", b: "2" }, objectsOf({ a: "1", b: "2" })],
			[{ a: "x" }, objectsOf({ a: "x" })],
		]);
		graded("f6-list-record", "cQuery", at("/c"), [
			[{ x: ["1", "2"] }, [...listsOf("1", "2"), ...objectsOf({ x: ["1", "2"] })]],
			[{ x: "5" }, [...spelled("5"), ...listsOf("5"), ...objectsOf({ x: "5" })]],
			[{ x: "007" }, [...spelled("007"), ...listsOf("007"), ...objectsOf({ x: "007" })]],
			[{ a: "1" }, objectsOf({ a: "1" })],
		]);
		graded("f6-list-record", "dQuery", at("/d"), [
			[{ x: ["1", "2"] }, [...listsOf("1", "2"), ...objectsOf({ x: ["1", "2"] })]],
			[{ x: "5" }, [...listsOf("5"), ...objectsOf({ x: "5" })]],
			[{ x: "007" }, [...listsOf("007"), ...objectsOf({ x: "007" })]],
			[{ x: "x" }, [...listsOf("x"), ...objectsOf({ x: "x" })]],
			[{ x: ["x", "y"] }, [...listsOf("x", "y"), ...objectsOf({ x: ["x", "y"] })]],
			[{ a: "1", b: "2" }, objectsOf({ a: "1", b: "2" })],
			[{ a: "x" }, objectsOf({ a: "x" })],
		]);
	});

	it("reads a model member declaring the parameter's own name as the model, and the list as itself", () => {
		graded("f6-list-record", "eQuery", at("/e"), [
			[{ x: ["1", "2"] }, [...listsOf("1", "2"), ...objectsOf({ x: ["1", "2"] })]],
			[{ x: "5" }, [...listsOf("5"), ...objectsOf({ x: "5" })]],
			[{ x: "z" }, [...listsOf("z"), ...objectsOf({ x: "z" })]],
			[{ y: "a" }, objectsOf({ y: "a" })],
			[{ x: "5", y: "a" }, [...listsOf("5"), ...objectsOf({ x: "5", y: "a" })]],
			[{ q: "z" }, [undefined]],
		]);
	});

	it("control: the list and the record each keep the value they were sent as", () => {
		const parsed = of("f6-list-record").schemas["aQuery"]?.safeParse({ x: ["1", "2"] });
		expect(parsed?.data).toEqual({ x: [1, 2] });
		expect(of("f6-list-record").schemas["aQuery"]?.safeParse({ a: "1", b: "2" }).data).toEqual({
			x: { a: 1, b: 2 },
		});
		// Already gathered by a caller holding the value: the object it built, not a list read from it.
		expect(of("f6-list-record").schemas["aQuery"]?.safeParse({ x: { x: 5 } }).data).toEqual({
			x: { x: 5 },
		});
		expect(of("f6-list-record").schemas["aQueryFields"]?.safeParse({ x: { x: 5 } }).data).toEqual({
			x: { x: 5 },
		});
	});
});

describe("a `{;v*}` path parameter of any type", () => {
	const at = (path: string) => ({ path, location: "path", name: "v" });
	const any: readonly Case[] = [
		[{ v: ";v=1;v=2" }, listsOf("1", "2")],
		[{ v: ";a=1;b=2" }, objectsOf({ a: "1", b: "2" })],
		[{ v: ";v=1;a=2" }, objectsOf({ v: "1", a: "2" })],
		[{ v: ";v=1" }, [...spelled("1"), ...listsOf("1"), ...objectsOf({ v: "1" })]],
		[{ v: ";v=x" }, [...spelled("x"), ...listsOf("x"), ...objectsOf({ v: "x" })]],
		[{ v: ";v" }, [...spelled(""), ...listsOf(""), ...objectsOf({ v: "" })]],
		[{ v: ";v=1,2" }, [...spelled("1,2"), ...listsOf("1,2"), ...objectsOf({ v: "1,2" })]],
		// Not the expansion of `{;v*}` at all: no leading `;`.
		[{ v: "v=1" }, []],
	];

	it("reads a list or an object from the expansion it spells, where the value may be anything", () => {
		graded("f3-any-matrix", "aPath", at("/a/{v}"), any);
		graded("f3-any-matrix", "bPath", at("/b/{v}"), any);
		graded("f3-any-matrix", "cPath", at("/c/{v}"), any);
		graded("f3-any-matrix", "fPath", at("/f/{v}"), [
			...any,
			[{ v: ";v=1;v=x" }, listsOf("1", "x")],
		]);
	});

	it("reads them as the numbers their text spells", () => {
		expect(of("f3-any-matrix").schemas["aPath"]?.safeParse({ v: ";v=1;v=2" }).data).toEqual({
			v: [1, 2],
		});
		expect(of("f3-any-matrix").schemas["cPath"]?.safeParse({ v: ";a=1;b=x" }).data).toEqual({
			v: { a: 1, b: "x" },
		});
	});

	it("control: a type that cannot be a list or an object still refuses their expansions", () => {
		graded("f3-any-matrix", "dPath", at("/d/{v}"), [
			[{ v: ";v=1;v=2" }, listsOf("1", "2")],
			[{ v: ";a=1;b=2" }, objectsOf({ a: "1", b: "2" })],
			[{ v: ";v=x" }, [...spelled("x"), ...listsOf("x")]],
		]);
		graded("f3-any-matrix", "ePath", at("/e/{v}"), [
			[{ v: ";a=1;b=2" }, objectsOf({ a: "1", b: "2" })],
			[{ v: ";v=x" }, [...spelled("x"), ...objectsOf({ v: "x" })]],
		]);
	});
});

describe("an exploded `{/v*}` path expansion", () => {
	const routeOf = (operationId: string): EmittedRoute => {
		const fixture = of("f4-slash-explode");
		const [[service]] = getAllHttpServices(fixture.compiled.program);
		if (service === undefined) throw new Error("no service");
		const found = collectRoutes(
			fixture.compiled.program,
			new SchemaRegistry(fixture.compiled.program),
			service,
		).find((route) => route.operationId === operationId);
		if (found === undefined) throw new Error(`no route ${operationId}`);
		return found;
	};
	const parsed = (exported: string, value: string): unknown => {
		const result = of("f4-slash-explode").schemas[exported]?.safeParse({ v: value });
		return result?.success === true ? (result.data as { v: unknown }).v : "refused";
	};

	/**
	 * **The document cannot state the `/` operator, so it describes a different URL.** openapi3 drops
	 * the operator from the path - `/lx{/v*}` is published `/lx{v}` - and, warning `invalid-style`,
	 * gives the parameter `simple` style, whose explode joins with `,`. That URL, `/lx1,2`, does not
	 * match the route `@typespec/http` declares, so no request a server mounted from the route receives
	 * is one the document reads as a list. What the route declares, and `@typespec/http-specs` expects
	 * of it (`/routes/path/path/explode/array/a/b`), is RFC 6570's `/a/b`.
	 */
	it("is published without its operator, under openapi3's own warning", () => {
		const fixture = of("f4-slash-explode");
		expect(Object.keys(fixture.document.paths).toSorted()).toEqual(
			["/l{v}", "/lx{v}", "/mx{v}", "/optl{v}", "/rx{v}", "/ul{v}"].toSorted(),
		);
		expect(documentParameter(fixture, "/lx{v}", "path", "v")).toMatchObject({ explode: true });
		expect(
			fixture.documentDiagnostics.filter(
				(each) => each === "warning @typespec/openapi3/invalid-style",
			),
		).toHaveLength(6);
	});

	it("is decoded as the route template declares it, which the route record carries", () => {
		expect(routeOf("lx").pathSegments.at(-1)).toMatchObject({ operator: "/", explode: true });
		expect(parsed("lxPath", "1/2")).toEqual([1, 2]);
		expect(parsed("lxPath", "1,2")).toBe("refused");
		expect(parsed("rxPath", "a=1/b=2")).toEqual({ a: 1, b: 2 });
		expect(parsed("mxPath", "a=1/b=x")).toEqual({ a: 1, b: "x" });
		expect(parsed("ulPath", "1/all")).toEqual([1, "all"]);
		expect(parsed("optlPath", "1/2")).toEqual([1, 2]);
	});

	it("is a known limit the reference states", () => {
		const reference = readFileSync(join(here, "..", "..", "..", "docs", "reference.md"), "utf8");
		const limits = reference.slice(reference.indexOf("## Known limits"));
		expect(limits).toMatch(/\{\/v\*\}/);
		expect(limits).toMatch(/invalid-style/);
	});

	it("control: an unexploded list joins with `,` under both, and agrees with the document", () => {
		graded("f4-slash-explode", "lPath", { path: "/l{v}", location: "path", name: "v" }, [
			[{ v: "1,2" }, listsOf("1", "2")],
			[{ v: "1" }, listsOf("1")],
			[{ v: "x" }, listsOf("x")],
		]);
	});
});

describe("a form-exploded model whose name is sent as a key it does not declare", () => {
	const at = (path: string) => ({ path, location: "query", name: "f" });

	it("reads the name as an extra parameter, as the document does", () => {
		graded("f5-own-name", "aQuery", at("/a"), [
			[{ f: "5" }, [undefined]],
			[{ zzz: "5" }, [undefined]],
			[{ x: "5", f: "5" }, objectsOf({ x: "5" })],
			[{ x: "z" }, objectsOf({ x: "z" })],
		]);
		graded("f5-own-name", "bQuery", at("/b"), [
			[{ f: "5" }, [undefined]],
			[{ x: "5" }, objectsOf({ x: "5" })],
		]);
		graded("f5-own-name", "dQuery", at("/d"), [
			[{ f: "5", q: "y" }, [undefined]],
			[{ q: "y" }, [undefined]],
		]);
		graded("f5-own-name", "eQuery", at("/e"), [
			[{ f: "5" }, [undefined]],
			[{ x: "5", f: "5" }, objectsOf({ x: "5" })],
		]);
		expect(of("f5-own-name").schemas["dQuery"]?.safeParse({ f: "5", q: "y" }).data).toEqual({
			q: "y",
		});
	});

	it("control: a model that declares the name takes it", () => {
		graded("f5-own-name", "cQuery", at("/c"), [
			[{ f: "5" }, objectsOf({ f: "5" })],
			[{ f: "z" }, objectsOf({ f: "z" })],
		]);
	});
});

describe("a parameter declared `never`", () => {
	it("is left out, as the document leaves it out, with nothing to report", () => {
		for (const sealed of [true, false]) {
			expect(ours("f8-never-params", sealed)).toEqual([]);
			const fixture = of("f8-never-params", sealed);
			for (const [path, location, name] of [
				["/a", "query", "a"],
				["/b", "header", "h"],
				["/c", "cookie", "k"],
				["/d", "query", "a"],
				["/e", "query", "a"],
				["/e", "header", "h"],
				["/e", "cookie", "k"],
			] as const) {
				expect(documentParameter(fixture, path, location, name), `${path} ${name}`).toBeUndefined();
			}
			const parsed = (exported: string, value: Record<string, unknown>): unknown => {
				const schema = fixture.schemas[exported];
				if (schema === undefined) return "no validator";
				const result = schema.safeParse(value);
				return result.success ? result.data : "refused";
			};
			expect(parsed("aQuery", { a: "1", q: "5" })).toEqual({ q: 5 });
			expect(parsed("aQuery", { a: "1" })).toEqual({});
			expect(parsed("bHeader", { h: "x" })).toBe("no validator");
			expect(parsed("cCookie", { k: "x" })).toBe("no validator");
			expect(parsed("dQuery", { a: "1", b: "x" })).toEqual({ b: "x" });
			expect(parsed("eQuery", { a: "1" })).toEqual({});
			expect(parsed("eHeader", { h: "x" })).toBe("no validator");
		}
	});

	it("leaves a parameter of its wire name to the declaration the document publishes", () => {
		graded("f8-never-params", "fQuery", { path: "/f", location: "query", name: "x" }, [
			[{ x: "5" }, spelled("5")],
			[{ x: "z" }, spelled("z")],
			[{}, [undefined]],
		]);
	});

	/**
	 * **What is still refused points at the parameter.** A `never` inside a parameter's type has no
	 * place of its own, and a parameter is walked outside any model, so its refusal was printed at
	 * `<unknown location>:1:1`. Compiled apart, in a directory of its own, because it is refused.
	 */
	it("control: a `never` it holds is refused where the parameter is declared", async () => {
		const located = join(here, "located");
		const compiled = await compileFixture(located, "never-list", {
			outName: "declarationviews-params-never-list",
		});
		const refusals = compiled.program.diagnostics.filter(
			(d) => d.code === "typespec-http-zod/unsupported-type",
		);
		expect(refusals).toHaveLength(1);
		const location = getSourceLocation(refusals[0]?.target as never);
		const { line, character } = location.file.getLineAndCharacterOfPosition(location.pos);
		expect([location.file.path.endsWith("never-list.tsp"), line + 1, character + 1]).toEqual([
			true,
			8,
			24,
		]);
	});

	it("is no input of the handler's", () => {
		const requests = readFileSync(
			join(of("f8-never-params").compiled.outDir, "requests.gen.ts"),
			"utf8",
		);
		expect(requests).not.toMatch(/^\s*"?[ahk]"?\??: never;$/m);
	});
});
