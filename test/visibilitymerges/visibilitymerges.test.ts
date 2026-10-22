import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Encodings, component references, merges and visibility, each held to the document.** Every
 * fixture is a minimal spec - `e-` for encodings and reading the wire, `p-` for which reference
 * openapi3 writes a component from and what it names it, `d-` for inheritance, merges, discrimination
 * and visibility - compiled sealed and open. A component is graded by Ajv on the document openapi3
 * publishes from the same program; a route's validator, which reads the wire rather than JSON, is
 * held to the values the document reads from that wire, written out here.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

interface Loaded {
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
	readonly components: readonly string[];
	readonly byDocument: (component: string, value: unknown) => boolean;
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
	) as { components?: { schemas?: Record<string, unknown> } };
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	const byDocument = (component: string, value: unknown): boolean =>
		ajv.validate(
			{ $ref: `#/components/schemas/${component}`, components: document.components },
			value,
		);
	return {
		compiled,
		schemas,
		components: Object.keys(document.components?.schemas ?? {}),
		byDocument,
	};
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

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

/** This emitter's errors and warnings, as `severity code`, sorted; the compiler's own left out. */
const ours = (name: string, sealed = true): string[] =>
	of(name, sealed)
		.compiled.program.diagnostics.filter((d) => d.code.startsWith("typespec-http-zod/"))
		.map((d) => `${d.severity} ${d.code.slice("typespec-http-zod/".length)}`)
		.toSorted();

/** The message of this emitter's diagnostic of a code, the first reported. */
const message = (name: string, code: string): string =>
	of(name).compiled.program.diagnostics.find((d) => d.code === `typespec-http-zod/${code}`)
		?.message ?? "";

/** Every value graded against the document, in both seal modes unless `sealedOnly`. */
function graded(name: string, cases: Record<string, readonly unknown[]>, sealedOnly = false): void {
	for (const sealed of sealedOnly ? [true] : [true, false]) {
		const fixture = of(name, sealed);
		for (const [component, values] of Object.entries(cases)) {
			const schema = fixture.schemas[`${lowerFirst(component)}Schema`];
			expect(schema, `${name} ${component}`).toBeDefined();
			for (const value of values) {
				let verdict: boolean;
				try {
					verdict = schema?.safeParse(value).success ?? false;
				} catch (error) {
					throw new Error(
						`${name} ${component} threw on ${JSON.stringify(value)}: ${String(error)}`,
					);
				}
				expect(verdict, `${name} sealed=${sealed} ${component} ${JSON.stringify(value)}`).toBe(
					fixture.byDocument(component, value),
				);
			}
		}
	}
}

/** A route validator's output for a wire value, or `"refused"`. */
const parsed = (name: string, exported: string, value: unknown, sealed = true): unknown => {
	const schema = of(name, sealed).schemas[exported];
	if (schema === undefined) return `no ${exported}`;
	const result = schema.safeParse(value);
	return result.success ? result.data : "refused";
};

/**
 * The document's components with no validator of their name, and the validators no component names.
 * openapi3's names are the contract both artefacts pair by.
 */
function names(name: string): { readonly missing: string[]; readonly extra: string[] } {
	const fixture = of(name);
	const expected = new Set(fixture.components.map((component) => `${lowerFirst(component)}Schema`));
	const declared = Object.keys(fixture.schemas).filter((exported) => exported.endsWith("Schema"));
	return {
		missing: [...expected].filter((each) => !declared.includes(each)),
		extra: declared.filter((each) => !expected.has(each)),
	};
}

const emitted = (name: string, file: string, sealed = true): string =>
	readFileSync(join(of(name, sealed).compiled.outDir, file), "utf8");

describe("every fixture's emitted set", () => {
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

describe("encodings and reading the wire", () => {
	it("reads a union member that takes any value from text, wherever the value is read", () => {
		expect(parsed("e-f1-any-member", "qQuery", { a: "12345" })).toEqual({ a: 12345 });
		expect(parsed("e-f1-any-member", "qQuery", { a: "true" })).toEqual({ a: true });
		expect(parsed("e-f1-any-member", "qQuery", { b: "5" })).toEqual({ b: 5 });
		expect(parsed("e-f1-any-member", "qHeader", { h: "12345" })).toEqual({ h: 12345 });
		expect(parsed("e-f1-any-member", "qCookie", { c: "12345" })).toEqual({ c: 12345 });
		expect(parsed("e-f1-any-member", "qQuery", { m: "k,12345" })).toEqual({ m: { k: 12345 } });
		expect(parsed("e-f1-any-member", "qQuery", { k: "12345" })).toEqual({ x: { k: 12345 } });
		expect(parsed("e-f1-any-member", "fBody", { k: "12345" })).toEqual({ k: 12345 });
		expect(parsed("e-f1-any-member", "ppPath", { p: "12345" })).toEqual({ p: 12345 });
		expect(parsed("e-f1-any-member", "ppPath", { p: "abc" })).toBe("refused");
		expect(parsed("e-f1-any-member", "ddPath", { d: "12345" })).toEqual({ d: 12345 });
	});

	it("reads a URL-encoded body of a union of models, or of a model or null, member by member", () => {
		expect(parsed("e-f2-form-union", "uBody", { kind: "a", n: "5" })).toEqual({ kind: "a", n: 5 });
		expect(parsed("e-f2-form-union", "uBody", { kind: "b", m: "true" })).toEqual({
			kind: "b",
			m: true,
		});
		expect(parsed("e-f2-form-union", "nBody", { kind: "a", n: "5" })).toEqual({ kind: "a", n: 5 });
	});

	it("reads a union holding a list wherever a key repeats, a lone value boxed into it", () => {
		const f3 = "e-f3-list-union";
		expect(parsed(f3, "xQuery", { ll: "x" })).toEqual({ f: { ll: ["x"] } });
		expect(parsed(f3, "xQuery", { ll: "5" })).toEqual({ f: { ll: [5] } });
		expect(parsed(f3, "xQuery", { ll: ["1", "x"] })).toEqual({ f: { ll: ["1", "x"] } });
		expect(parsed(f3, "xQuery", { lb: "5" })).toEqual({ f: { lb: [5] } });
		expect(parsed(f3, "rQuery", { k: ["1", "x"] })).toEqual({ f: { k: ["1", "x"] } });
		expect(parsed(f3, "rQuery", { k: "x" })).toEqual({ f: { k: ["x"] } });
		expect(parsed(f3, "flBody", { ll: ["1", "x"] })).toEqual({ ll: ["1", "x"] });
		expect(parsed(f3, "flBody", { lb: "5" })).toEqual({ lb: [5] });
	});

	it("keeps a model named after a reader helper apart from it", () => {
		expect(of("e-f4-wirereader").schemas.wireReader_Schema).toBeDefined();
	});

	it("fills a key an object default leaves out with its own default", () => {
		expect(parsed("e-f5-partial-default", "outerSchema", {})).toEqual({
			inner: { a: 1, b: "x" },
		});
	});

	it("reads a spec's own types named like standard ones as the spec declares them", () => {
		graded("e-f6-std-names", {
			M: [
				{ u: "abc" },
				{ u: 5 },
				{ d: 5 },
				{ d: "PT1S" },
				{ b: 5 },
				{ b: "AQID" },
				{ r: { a: 1 } },
			],
		});
		expect(parsed("e-f6-std-names", "formSchema", { f: '{"name":"x"}' })).toEqual({
			f: { name: "x" },
		});
		expect(of("e-f6-std-names").schemas.recordSchema).toBeDefined();
		expect(emitted("e-f6-std-names", "requests.gen.ts")).toMatch(/export interface Record\b/);
	});

	it("decodes a part holding raw bytes as JSON where JSON is all the document publishes", () => {
		const f7 = "e-f7-bytes-null-part";
		expect(parsed(f7, "formSchema", { bn: "x" })).toBe("refused");
		expect(parsed(f7, "formSchema", { bn: "TRUE" })).toBe("refused");
		expect(parsed(f7, "formSchema", { bn: "5" })).toEqual({ bn: 5 });
		expect(parsed(f7, "formSchema", { bn: "null" })).toEqual({ bn: null });
	});

	it("says a union-typed object default is dropped because openapi3 publishes it as `{}`", () => {
		expect(message("e-f8-union-default", "invalid-default")).toContain(
			"openapi3 publishes it as {}",
		);
	});

	it("declares a spec's types named after library types the files name, the library's through `globalThis`", () => {
		const fixture = of("e-libnames");
		for (const exported of ["recordSchema", "promiseSchema", "readonlySchema", "excludeSchema"]) {
			expect(fixture.schemas[exported], exported).toBeDefined();
		}
		// Named bare by the files themselves, these two take the `_` a helper's name does.
		expect(fixture.schemas.arrayBuffer_Schema).toBeDefined();
		expect(fixture.schemas.uint8Array_Schema).toBeDefined();
		const requests = emitted("e-libnames", "requests.gen.ts");
		expect(requests).toContain("none: globalThis.Record<string, never>;");
		expect(requests).toContain("arrayBuffer: () => globalThis.Promise<ArrayBuffer>");
		expect(emitted("e-libnames", "schemas.gen.ts")).toContain(
			"globalThis.Readonly<globalThis.Record<string, WireReader>>",
		);
	});
});

describe("which reference openapi3 writes a component from, and its name", () => {
	it("validates a component as declared where another declaration publishes its read-only key", () => {
		graded("p-d2-rodisc", {
			Pet: [{ kind: "s", name: "s" }],
			Cat: [{ kind: "cat", name: "s", meow: true }],
		});
		graded("p-d3-redeclro", { Derived: [{ id: "s", name: "s" }, { name: "s" }] });
		graded("p-d4-roindexer", {
			M: [
				{ id: "a", name: "n" },
				{ id: 5, name: "n" },
				{ name: "n" },
				{ id: "a", name: "n", x: "y" },
			],
		});
		graded("p-d5-inheritredecl", {
			D: [
				{ id: "a", name: "n", extra: "e" },
				{ id: 5, name: "n", extra: "e" },
				{ name: "n", extra: "e" },
			],
		});
		for (const name of ["p-d2-rodisc", "p-d3-redeclro", "p-d4-roindexer"]) {
			expect(ours(name), name).toEqual([]);
		}
	});

	it("writes a spread model expression out where openapi3 does, outside a body root", () => {
		graded("p-b3-discspread", {
			Holder: [
				{ p: { kind: "cat", name: "x", meow: true } },
				{ p: { kind: "dog", name: "x", zz: 1 } },
				{ p: { kind: "cat", name: "x" } },
			],
		});
		graded("p-b5-splitspread", { Holder: [{ i: { id: "s", name: "s" } }, { i: { name: "s" } }] });
		expect(ours("p-b6-spreadsplit")).toEqual(["error split-visibility"]);
		expect(parsed("p-b8-spreadparam", "listQuery", { id: "a", name: "n" })).toEqual({
			f: { id: "a", name: "n" },
		});
		expect(names("p-b1b-reacheff")).toEqual({ missing: [], extra: [] });
	});

	it("validates a body by the model openapi3 resolves it to", () => {
		graded("p-c3-explicitbodyeff", { Foo: [{ name: "x" }, { name: "x", h: "y" }, { h: "y" }] });
		graded("p-c3b-explicitresp", { Foo: [{ name: "x" }, { name: "x", h: "y" }, { h: "y" }] });
		const pets = [
			{ kind: "cat", name: "x", meow: true },
			{ kind: "dog", name: "x", zz: 1 },
			{ kind: "dog", name: "x" },
		];
		graded("p-c4-intersectbody", { Pet: pets });
		graded("p-c5-effvariants", { Pet: pets });
		// Each body is the component itself, so no route declares a validator of its own for it.
		for (const [name, exported] of [
			["p-c3-explicitbodyeff", "createBody"],
			["p-c4-intersectbody", "createABody"],
			["p-c5-effvariants", "createCBody"],
		] as const) {
			expect(of(name).schemas[exported], `${name} ${exported}`).toBeUndefined();
		}
	});

	it("names a declaration by its `@friendlyName`, reached through a copy too", () => {
		expect(names("p-f9-friendlyonly")).toEqual({ missing: [], extra: [] });
		expect(names("p-b4-friendlyspread")).toEqual({ missing: [], extra: [] });
		// The route holds the named component, as the document's `$ref` does, and writes no copy of its own.
		expect(of("p-f9-friendlyonly").schemas.hResponse200).toBeUndefined();
		expect(of("p-b4-friendlyspread").schemas.createBody).toBeUndefined();
		graded("p-f7-friendlyswap", { A: [{ a: "x" }, { b: 1 }], B: [{ a: "x" }, { b: 1 }] });
	});

	it("walks nothing a `@useRef` response or parameter publishes, and refuses the parameter", () => {
		expect(ours("p-b2-userefresp")).toEqual(["error split-visibility", "error unsupported-type"]);
		expect(ours("p-b7-userefparam")).toEqual(["error split-visibility", "error unsupported-type"]);
		expect(message("p-b7-userefparam", "unsupported-type")).toContain(
			"other.json#/components/parameters/I",
		);
	});

	it("names a component the unreached pass reaches by the exact type openapi3 tracks", () => {
		expect(names("p-b1e-unreachhdr")).toEqual({ missing: [], extra: [] });
		expect(names("p-b1-unreacheff")).toEqual({ missing: [], extra: [] });
	});

	it("names a remedy that compiles for a union root, and keeps the view the document keeps", () => {
		const split = message("p-r5-unionroot", "split-visibility");
		expect(split).toContain("send a model of 'H2OrNull' holding only what that request sees");
		expect(split).not.toContain("Create<H2OrNull>");
		/**
		 * `D`, sent in a create body and reached through `B`'s derived models at `Read`, is two views
		 * under one name; the document keeps the one written last, and so does its validator - no
		 * collision is reported where openapi3 refuses its own document.
		 */
		expect(ours("p-g1-derivedread")).toEqual([]);
		graded("p-g1-derivedread", { D: [{ b: "x" }, { b: "x", secret: "s" }] });
		// `M` in a tuple sent and returned: the document keeps its create view, and so does `mSchema`.
		expect(ours("p-t1-tuple")).toEqual(["error split-visibility"]);
		graded("p-t1-tuple", {
			M: [{ name: "n" }, { name: "n", secret: "s" }],
			HolderCreate: [{ s: "s", pair: [{ name: "n", secret: "s" }] }],
		});
	});
});

describe("inheritance, merges, discrimination and visibility", () => {
	it("holds a variant no dispatch can read beside it: a discriminated base, a recursive declaration", () => {
		graded("d-dd3", {
			Pet: [
				{ kind: "dog" },
				{ kind: "cat", breed: "siamese" },
				{ kind: "cat", breed: "x" },
				{ kind: "eel" },
			],
		});
		graded("d-cy3", {
			TreeN: [
				{ kind: "leaf", v: 1 },
				{ kind: "node", kids: [{ kind: "leaf", v: 1 }], extra: "s" },
				{ kind: "node", extra: 1 },
				{ kind: "x" },
			],
		});
		graded("d-cy4", {
			Pet: [
				{ kind: "cat", friend: { kind: "x" } },
				{ kind: "cat", a: 1 },
				{ kind: "cat", a: "s" },
				{ kind: "x", a: { kind: "y" } },
			],
		});
	});

	it("narrows into a union only where no other member takes a value of the override too", () => {
		const ks = ["green", "red", "ab", "abc", "abcd"];
		graded("d-nu1", {
			Sub: ks.map((k) => ({ x: { k } })),
			Sub2: ks.map((k) => ({ x: { k } })),
			Sub3: ks.map((k) => ({ k })),
		});
	});

	it("merges two lists whose elements openapi3 publishes at different visibilities", () => {
		const vs = [{ u: [{ e: { c: true } }] }, { u: [{}] }, { u: [] }, { u: [{ e: {} }] }];
		graded("d-la1", { SubUpdate: vs, Sub2Update: vs });
		// `k0` left out: optional under the PATCH, and a string there turns on a format Ajv is not asked to check.
		graded("d-f130", {
			LeafEUpdate: [
				{ k1: [{ kind: "x", value: {} }] },
				{ k1: [{ kind: "x", value: { a: "red", b: "ab" } }] },
				{ k1: [{ kind: "x", value: { a: "red", b: "a" } }] },
			],
		});
		graded("d-f5064", {
			LeafBUpdate: [{ u: [{ e: {} }] }, { u: [{ e: { c: null } }] }, { u: [{ e: { c: true } }] }],
		});
	});

	it("dispatches a visibility template of a base only to subtypes published as `allOf` it", () => {
		const vs = [
			{ kind: "cat", x: { name: "n" } },
			{ kind: "cat", x: { name: "n", pw: "p" } },
			{ kind: "dog", x: { name: "n" } },
			{ kind: "cat" },
		];
		graded("d-vt2", { CreatePet: vs, Pet: vs });
		graded("d-vt3", { UpdatePet: vs, CreateOrUpdatePet: vs, PetCreate: vs });
		const as = [
			{ kind: "bird" },
			{ kind: "bird", wings: 2 },
			{ kind: "x" },
			{ kind: "bird", wings: "x" },
		];
		const e = { kind: "cat", value: { kind: "cat", pw: "p" } };
		const n = { kind: "cat", pw: "p" };
		graded("d-vt5", {
			CreateAnimal: as,
			CreateHolder: as.flatMap((a) => [
				{ e, n, a },
				{ e, n, l: [a] },
			]),
		});
		// A visibility template's copy of `Animal[]` is a list literal, written out where it is used.
		expect(ours("d-vt5")).toEqual([]);
	});

	it("validates a tuple's elements at the visibility of the model holding it", () => {
		const o = { e: "x" };
		const vs = [
			{ o, t: [{ e: "x", b: "y" }, "s"] },
			{ o, t: [{}, "s"] },
			{ o, t: [{ e: "x" }, "s"] },
		];
		graded("d-tu3", { HCreate: vs, HUpdate: vs, H: vs });
	});

	it("refuses the `null` a `@oneOf` matches more than once", () => {
		const vs = [null, 1, "a", "x"];
		graded("d-un1", {
			...Object.fromEntries(["U1", "U2", "U3", "U4", "U5", "U7", "U8", "U9"].map((u) => [u, vs])),
			H: [
				{ p1: 1, p2: null, p3: 1, p4: "a", p5: [1] },
				{ p1: null, p3: 1, p4: "a", p5: [1] },
				{ p1: 1, p2: "s", p3: 1, p4: "a", p5: [1] },
			],
		});
	});

	it("merges a `@oneOf` of typeless members as the union it is, not as keywords", () => {
		graded("d-ty1", {
			Sub: [{}, { x: 1 }, { x: null }, { x: "a" }],
			Sub2: [{ x: 1 }, { x: null }, { x: "a" }],
			Sub3: [{ m: { y: "a" } }, { m: { y: "a", x: 1 } }, { m: { y: "a", x: null } }],
			Sub4: [{ x: "a" }, { x: 1 }],
			Sub5: [{ x: "a" }, { x: null }],
			Sub6: [{ x: null }],
		});
	});

	it("holds a merge of a declaration refused as a collision to nothing, whichever is declared first", () => {
		for (const name of ["d-dup2", "d-dup2b"]) {
			graded(name, { SubCreate: [{ x: { n: "a" } }] });
			expect(ours(name), name).toEqual(["error duplicate-declaration"]);
		}
	});

	it("says a subtype's discriminator is not visible where the request is", () => {
		const said = message("d-dv1", "invalid-subtype-discriminator");
		expect(said).toContain("its 'kind' is not visible at 'Create'");
		expect(said).toContain("Make 'kind' visible at 'Create' on 'Dog'");
		expect(said).not.toContain("Declare 'kind' on 'Dog' as one fixed value");
		const vs = [{ name: "a" }, { kind: "cat", name: "a" }, { kind: "dog", name: "a" }];
		graded("d-dv1", { PetCreate: vs, Pet: vs, CatCreate: vs, Dog: vs });
	});
});
