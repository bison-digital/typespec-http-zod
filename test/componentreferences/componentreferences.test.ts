import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listServices, navigateTypesInNamespace } from "@typespec/compiler";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Which reference a component is written from, and what it is named, each held to the document.**
 * Every fixture here is a minimal spec - `p-` for which reference openapi3 writes a component from
 * and what it names it, `d-` for inheritance and discrimination, `e-` for encodings and parameter
 * reading - compiled sealed and open. A component is graded by Ajv on the document openapi3 publishes
 * from the same program; a route's validator, which reads the wire rather than JSON, is held to the
 * values the document reads from that wire, written out here.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

interface Loaded {
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
	readonly byDocument: (component: string, value: unknown) => boolean;
	readonly components: readonly string[];
	/** The scalars the service declares, which openapi3 publishes and this emitter validates inline. */
	readonly scalars: ReadonlySet<string>;
}

const loaded = new Map<string, Loaded>();

async function load(name: string, sealed: boolean): Promise<Loaded> {
	const outName = `${name}-${sealed ? "sealed" : "open"}`;
	const compiled = await compileFixture(name in written ? source : here, name, {
		outName,
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
	const scalars = new Set<string>();
	for (const service of listServices(compiled.program)) {
		navigateTypesInNamespace(service.type, { scalar: (scalar) => void scalars.add(scalar.name) });
	}
	return {
		compiled,
		schemas,
		byDocument,
		components: Object.keys(document.components?.schemas ?? {}),
		scalars,
	};
}

/**
 * **`e-names` is written here, with an escape, and compiled from `.out/`**: its model and operation
 * id are named outside ASCII, which no tracked file may carry (`test/portability.test.ts`) and a
 * `.tsp` cannot spell with an escape.
 */
const E_ACUTE = "\u00e9";
const written: Record<string, string> = {
	"e-names": `import "@typespec/http";
import "@typespec/openapi";
using Http;
using OpenAPI;

@service(#{ title: "Names" })
namespace Names;

model Caf${E_ACUTE} { id: int32; }
model Q { i64?: int64 = 9007199254740993; }

@route("/a") @post @operationId("caf${E_ACUTE}") op a(@body body: Caf${E_ACUTE}): Caf${E_ACUTE};
@route("/b") @post op b(@body body: Q): void;
`,
};
const source = join(here, ".out", "source");

const fixtures = [
	...readdirSync(here)
		.filter((file) => file.endsWith(".tsp"))
		.map((file) => file.slice(0, -".tsp".length)),
	...Object.keys(written),
];

beforeAll(async () => {
	mkdirSync(source, { recursive: true });
	for (const [name, text] of Object.entries(written))
		writeFileSync(join(source, `${name}.tsp`), text);
	for (const name of fixtures) {
		for (const sealed of [true, false]) loaded.set(`${name}:${sealed}`, await load(name, sealed));
	}
}, 600_000);

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

/** A route validator's verdict and output for a wire value. */
const parsed = (name: string, exported: string, value: unknown): unknown => {
	const result = of(name).schemas[exported]?.safeParse(value);
	return result?.success === true ? result.data : "refused";
};

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

describe("every component the document publishes, declared under its name", () => {
	/** The types a generated file declares, by name. */
	const declaredIn = (name: string, sealed: boolean, file: string): Set<string> =>
		new Set(
			[
				...readFileSync(join(of(name, sealed).compiled.outDir, file), "utf8").matchAll(
					/^export (?:type|interface) ([A-Za-z0-9_]+)\b/gm,
				),
			].map((match) => match[1] as string),
		);

	it("declares each one, validator and contract type, and no other but what an omitted route uses", () => {
		/**
		 * **The README's claim, held against every fixture.** A component no route names was left
		 * undeclared: one a merge holds (`d-d1chain`'s `B` and `Sub`), a list or a union instance a
		 * reduced model refers to at the visibility openapi3 reads its properties at (`p-f4`'s
		 * `TagsR1Create` and `MaybeR2Create`, with a `MaybeR2` the document does not have declared
		 * instead), an enum an encoded list holds (`e-enumlist`'s `Colors`). Scalars are validated
		 * inline, as the README says; `p-f13`'s `OuterQ` is the body of a route whose path holds a
		 * query string, which openapi3 leaves out and this emitter serves.
		 */
		const omitted: Readonly<Record<string, readonly string[]>> = { "p-f13": ["OuterQ"] };
		for (const name of fixtures) {
			for (const sealed of [true, false]) {
				const fixture = of(name, sealed);
				const components = fixture.components.filter((each) => !fixture.scalars.has(each));
				const schemas = declaredIn(name, sealed, "schemas.gen.ts");
				const contracts = declaredIn(name, sealed, "requests.gen.ts");
				const where = `${name} sealed=${sealed}`;
				expect(
					components.filter((each) => !schemas.has(each)),
					`${where}: components without a validator`,
				).toEqual([]);
				expect(
					components.filter((each) => !contracts.has(each)),
					`${where}: components without a contract type`,
				).toEqual([]);
				expect(
					[...schemas].filter((each) => !components.includes(each)),
					`${where}: validators no component names`,
				).toEqual(omitted[name] ?? []);
			}
		}
	});

	it("refers to a list a reduced model holds by the name openapi3 reads it under", () => {
		const { outDir } = of("p-f4").compiled;
		expect(readFileSync(join(outDir, "schemas.gen.ts"), "utf8")).toMatch(
			/export const midR1Schema = z\.strictObject\(\{\s*tags: tagsR1CreateSchema,/,
		);
		expect(readFileSync(join(outDir, "requests.gen.ts"), "utf8")).toMatch(
			/export interface MidR1 \{\s*tags: TagsR1Create;/,
		);
	});
});

describe("which reference openapi3 writes a component from, and its name", () => {
	it("names a spread body's model by the model's usage, not its copy's", () => {
		expect(ours("p-f14")).toEqual([]);
		expect(of("p-f14").schemas.userSchema).toBeDefined();
		expect(of("p-f14").schemas.userCreateSchema).toBeDefined();
	});

	it("refuses one model published at two visibilities under one name, once, in a module that loads", () => {
		expect(ours("p-f6")).toEqual(["error duplicate-declaration"]);
		const message = of("p-f6").compiled.program.diagnostics.find((d) =>
			d.code.endsWith("duplicate-declaration"),
		)?.message;
		expect(message).toContain("at 'Update' and at 'Update | Patch'");
	});

	it("leaves a subtype openapi3 publishes split out of the base's dispatch, which then never throws", () => {
		expect(ours("p-f15")).toEqual(["error split-visibility", "error split-visibility"]);
		graded("p-f15", { Pet: [{ kind: "x" }, { kind: "cat" }], PetB: [{ kind: "dog", name: "n" }] });
	});

	it("declares an envelope per visibility it is published at, optional under a PATCH", () => {
		graded("p-f7", {
			PetC: [
				{ kind: "cat", value: { name: "n" } },
				{ kind: "cat", value: { secret: "s", name: "n" } },
			],
			PetCCreate: [
				{ kind: "cat", value: { secret: "s", name: "n" } },
				{ kind: "cat", value: { name: "n" } },
			],
		});
		graded("d-d20env", {
			HUpdate: [
				{ b: { kind: "v1", value: {} } },
				{ b: { kind: "v1" } },
				{ b: {} },
				{ b: { value: { a: 1 } } },
			],
			H: [{ b: { kind: "v1", value: { a: 1 } } }, { b: { kind: "v1" } }],
		});
		graded("d-d24du", {
			HUpdate: [
				{ pet: { meow: 1 } },
				{ pet: { bark: "b" } },
				{ pet: {} },
				{ pet: { kind: "dog", meow: 1 } },
			],
			H: [{ pet: { kind: "cat", meow: 1 } }, { pet: { meow: 1 } }],
		});
	});

	it("judges a model expression by the emission openapi3 caches, wherever it is written out", () => {
		expect(ours("p-f1")).toEqual(["error split-visibility"]);
		graded("p-f1", {
			OuterX2Create: [
				{ secret: "s", meta: { id: "1", name: "n" } },
				{ secret: "s", meta: { name: "n" } },
			],
		});
		graded("p-f1", { OuterX1: [{ meta: { id: "1", name: "n" } }, { meta: { name: "n" } }] }, true);
	});

	it("judges an operation's own expression where openapi3 collapses it, at `Read`", () => {
		expect(ours("p-f2")).toEqual([]);
	});

	it("follows a shared route's parameters by name, and an operation openapi3 drops not at all", () => {
		const message = of("p-f3").compiled.program.diagnostics.find((d) =>
			d.code.endsWith("split-visibility"),
		)?.message;
		expect(ours("p-f3")).toEqual(["error split-visibility"]);
		expect(message).toContain("publishes 'InnerA'");
		expect(ours("p-f13")).toEqual([]);
		graded("p-f13", { InnerQ: [{ id: "1", name: "n" }, { name: "n" }] });
	});

	it("refuses no list model or union instance for a component it refers to at another visibility", () => {
		expect(ours("p-f4")).toEqual([]);
		graded("p-f4", { MidR1: [{ tags: [{ name: "n" }] }, { tags: [{}] }] });
	});

	it("judges a component by the declaration `components.schemas` keeps, the last written", () => {
		expect(ours("p-f5")).toEqual([]);
		graded("p-f5", { InnerU1: [{ id: "1", name: "n" }, { name: "n" }] });
	});

	it("renders a multipart part as the model it stands for, collapsed as openapi3 collapses it", () => {
		graded("p-f8", { InnerJ: [{ id: "1", name: "n" }, { name: "n" }] });
	});

	it("reads a shared parameter at the visibility its component is published at", () => {
		expect(parsed("p-f9", "createAQuery", { name: "n" })).toEqual({ f: { name: "n" } });
		// `c` is not `FilterA`'s where the shared parameter is published, so it is no key of `f`.
		expect(parsed("p-f9", "createAQuery", { c: "x", name: "n" })).toEqual({ f: { name: "n" } });
	});

	it("declares a union template instance the document publishes", () => {
		expect(of("p-f10").schemas.maybeN1Schema).toBeDefined();
		graded("p-f10", { MaybeN1: [null, { name: "n" }, {}] });
	});

	it("refuses a list template instance, which openapi3 publishes as an object", () => {
		expect(ours("p-f11")).toEqual(["error unsupported-type"]);
	});

	it("reads a shared route's requests at the visibility openapi3 publishes them at", () => {
		expect(of("p-f12").schemas.thingCCreateSchema).toBeDefined();
		expect(of("p-f12").schemas.thingCUpdateSchema).toBeUndefined();
	});
});

describe("inheritance, discrimination and merges", () => {
	it("merges two `@oneOf` unions member by member, exclusivity kept", () => {
		graded("d-d19xor", {
			Sub: [{ q: 2 }, { q: 2.5 }, { q: "abcd" }, { q: "abc" }],
			Sub2: [{ u: { c: 1 } }, { u: {} }],
		});
		graded("d-d2a", {
			Sub1: [{ u: {} }, { u: { a: "x" } }, { u: { c: 1 } }],
			Sub2: [{ u: {} }, { u: { a: "x" } }, { u: { c: 1 } }],
			Sub3: [{ u: "x" }, { u: "y" }],
			Base1: [{ u: {} }, { u: { a: "x" } }],
		});
		graded("d-d2b", { Base4: [{ v: {} }, { v: { a: "x" } }, { v: "abc" }, { v: "abcdef" }] });
	});

	it("validates each component a merge holds by itself as well, as the document publishes it", () => {
		graded("d-d1chain", {
			L2: [
				{ p: "abc", m: { x: "a" } },
				{ p: "abc", m: { x: "a", y: 1 } },
				{ p: "abc", m: { x: "a", z: "s" } },
				{ p: "abcdefg", m: { x: "a" } },
				{ p: "abc", m: { x: "a" }, n: 11 },
				{ p: "abc", m: { x: "a" }, n: 200 },
			],
			B: [{ x: "a" }, { x: "a", z: "s" }, { x: "a", y: 1 }, {}],
			Sub: [{ x: "a" }, { x: "a", y: 1 }, { x: "a", z: "s" }],
		});
		graded("d-d22split", { B: [{ id: "1", x: "a" }, { x: "a" }] }, true);
	});

	it("holds a merge to a component openapi3 publishes split as to no value", () => {
		graded(
			"d-d22split",
			{
				Sub: [{ m: { id: "1", x: "a" } }, { m: { x: "a" } }],
				SubU: [{ u: { id: "1", x: "a" } }, { u: 5 }],
			},
			true,
		);
	});

	it("merges a record's values and a list's elements at the visibility each is published at", () => {
		graded("d-d25rec", {
			LeafA: [{ q: { x: { b: 9 } } }, { q: { x: { c: "c" } } }],
			LeafL: [{ q: [{ b: 9 }] }, { q: [{ c: "c" }] }],
			LeafN: [{ q: { b: 9 } }, { q: {} }],
			// `x` is a key `QX` declares and `RecM1`'s values hold, as `RecM1` publishes them: at `Read`.
			LeafX: [
				{ u: { x: { b: 9 } } },
				{ u: { x: { b: 9, c: "c" } } },
				{ u: { k: { c: "c" }, x: { b: 9 } } },
				{ u: { k: { c: "c" }, x: { b: 9, c: "c" } } },
				// Open, a key `QX` does not declare is held to `RecM1`'s values, at `Read`, `c` required.
				{ u: { k: { b: 9 } } },
				{ u: { k: { c: "c" } } },
			],
		});
		/**
		 * Where `M1` is published at one visibility only, the copy rendered at the merge's own was a
		 * second schema under its one name, refused as a collision and validating nothing.
		 */
		expect(ours("d-d25one", false)).toEqual([]);
		// `M1` beside itself at another visibility is not narrowed by itself: `x` is held to both.
		graded("d-d25same", {
			LeafX: [
				{ u: { x: { b: 9 } } },
				{ u: { x: { b: 9, c: "c" } } },
				{ u: { k: { b: 9 } } },
				{ u: { k: { c: "c" } } },
			],
		});
		graded("d-d25one", {
			LeafX: [
				{ u: { x: { b: 9 } } },
				{ u: { x: { b: 9, c: "c" } } },
				{ u: { k: { b: 9 } } },
				{ u: { k: { c: "c" } } },
			],
		});
		graded("d-d26list", {
			R1: [{ t: [{}] }, { t: [{ name: "n" }] }],
			R3: [{ t: [{}] }, { t: [{ name: "n" }] }],
		});
	});
});

describe("a default filled in only where the value it fills is one the validator accepts", () => {
	/** What a validator fills in for a value it accepts, asked again of the same validator. */
	const refilled = (name: string, component: string, value: unknown): boolean | "refused" => {
		const schema = of(name).schemas[`${lowerFirst(component)}Schema`];
		const result = schema?.safeParse(value);
		return result?.success === true ? (schema?.safeParse(result.data).success ?? false) : "refused";
	};

	it("holds a default's keys to every declaration above them, at any depth", () => {
		expect(ours("d-d9def")).toEqual(Array(5).fill("warning invalid-default"));
		graded("d-d9def", {
			M3: [{ m: { x: "s" } }, { m: { x: "s", k: 5 } }],
			D1: [{}, { i: { a: "x" } }],
			DD: [{}, { o: { k: "abc" } }, { o: { k: "toolong" } }],
			DL: [{}, { o: { l: ["a"] } }, { o: { l: ["a", "b"] } }],
			DD2: [{}, { o: { inner: { k: "abc" } } }, { o: { inner: { k: "toolong" } } }],
		});
		for (const component of ["M3", "D1", "DD", "DL", "DD2"]) {
			expect(refilled("d-d9def", component, component === "M3" ? { m: { x: "s" } } : {})).toBe(
				true,
			);
		}
	});

	it("holds a default to the value of an indexer merged with its model", () => {
		expect(ours("d-d27def")).toEqual(["warning invalid-default"]);
		graded("d-d27def", {
			Sub: [{ u: {} }, { u: { z: 1 } }, { u: { z: 1, k: 7 } }, { u: { z: 1, k: 3 } }],
		});
		expect(refilled("d-d27def", "Sub", { u: { z: 1 } })).toBe(true);
	});
});

describe("parameters and multipart, read from the wire", () => {
	it("gathers a form-exploded union of models once, each member reading its own keys", () => {
		expect(parsed("e-repro", "f1Query", { kind: "a", x: "1" })).toEqual({
			p: { kind: "a", x: "1" },
		});
		expect(parsed("e-repro", "f1Query", { kind: "b", y: "1" })).toEqual({
			p: { kind: "b", y: "1" },
		});
		expect(parsed("e-repro", "f1bQuery", { kind: "cat", lives: "9" })).toEqual({
			p: { kind: "cat", lives: 9 },
		});
		expect(parsed("e-repro", "f1cQuery", {})).toBe("refused");
	});

	it("reads a value that may be one or a list as either, and a `| null` beside a list as the list", () => {
		expect(parsed("e-repro", "f2Query", { e: ["1", "2"] })).toEqual({ l: { e: [1, 2] } });
		expect(parsed("e-repro", "f2Query", { e: "1" })).toEqual({ l: { e: 1 } });
		expect(parsed("e-repro", "f2bQuery", { a: ["1", "2"] })).toEqual({ r: { a: [1, 2] } });
		expect(parsed("e-repro", "f2bQuery", { a: "1" })).toEqual({ r: { a: [1] } });
	});

	it("gathers only the keys the model's validator declares where it is used", () => {
		expect(parsed("e-repro", "f3Query", { a: "1", secret: "x" })).toEqual({ g: { a: 1 } });
	});

	it("reads a mixed text-or-JSON part as JSON where its text is, and as text otherwise", () => {
		expect(parsed("e-repro", "partsSchema", { iad: '{"city":"x"}' })).toEqual({
			iad: { city: "x" },
		});
		expect(parsed("e-repro", "partsSchema", { iad: "5" })).toEqual({ iad: 5 });
		expect(parsed("e-repro", "f4Body", { many: "5" })).toEqual({ many: [5] });
		expect(parsed("e-repro", "partsSchema", { many: "5" })).toBe("refused");
	});

	it("declares an enum an encoded list holds, which the document publishes as a component", () => {
		graded("e-enumlist", { Colors: ["blue", "black"] });
	});

	it("reads a discriminated header as the subtype it names", () => {
		expect(parsed("e-repro", "f10Header", { s: "kind,cobra,length,5" })).toEqual({
			s: { kind: "cobra", length: 5 },
		});
	});

	it("refuses two headers differing only in case, and every default its own check refuses", () => {
		expect(ours("e-repro")).toEqual([
			"error header-case-collision",
			"warning invalid-default",
			"warning invalid-default",
			"warning invalid-default",
		]);
		expect(parsed("e-repro", "f8Header", { "x-foo": "5" })).toBe("refused");
		expect(parsed("e-repro", "f8Header", {})).toEqual({});
	});

	it("writes every generated file in printable ASCII, a non-ASCII name included", () => {
		const { outDir } = of("e-names").compiled;
		for (const file of readdirSync(outDir).filter((each) => each.endsWith(".gen.ts"))) {
			expect(readFileSync(join(outDir, file), "utf8"), file).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
		}
	});
});
