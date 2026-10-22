import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Reading the wire, merges and component references, each held to the document.** Every fixture
 * is a minimal spec - `d-` for inheritance, merges and discrimination, `e-` for encodings and
 * reading parameters and bodies from the wire, `p-` for which reference openapi3 writes a component
 * from and what it names it - compiled sealed and open. A component is graded by Ajv on the document
 * openapi3 publishes from the same program; a route's validator, which reads the wire rather than
 * JSON, is held to the values the document reads from that wire, written out here.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

interface Loaded {
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
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
	return { compiled, schemas, byDocument };
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

/** A route validator's verdict and output for a wire value. */
const parsed = (name: string, exported: string, value: unknown, sealed = true): unknown => {
	const schema = of(name, sealed).schemas[exported];
	if (schema === undefined) return `no ${exported}`;
	const result = schema.safeParse(value);
	return result.success ? result.data : "refused";
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

describe("inheritance, merges and discrimination", () => {
	it("reads an enum a constrained string narrows as its members, in a module that loads", () => {
		graded("d-r01", {
			S: [{ d: { kind: "y", value: { e: "red" } } }, { d: { kind: "z", value: { e: "abc" } } }],
		});
	});

	it("dispatches to a subtype published at two visibilities under one name as the document keeps it", () => {
		// `Dog` at `All` and at `Read` under one name: the document keeps `Read`, so it is no collision.
		expect(ours("d-r02")).toEqual([]);
		graded("d-r02", {
			Pet: [
				{ kind: "cat", name: "x" },
				{ kind: "eel", name: "x" },
				{ kind: "dog", name: "x" },
				{ kind: "dog", name: "x", pw: "s" },
			],
			Dog: [
				{ kind: "dog", name: "x" },
				{ kind: "dog", name: "x", pw: "s" },
			],
		});
		for (const name of ["p-d1-unreachdisc", "p-d2-dupdisc"]) {
			graded(name, { Pet: [{ kind: "dog", bark: "s" }, { kind: "other" }, { kind: "dog" }] });
		}
	});

	it("spells out a nested union where it meets another declaration, never joining two objects", () => {
		graded("d-r03", {
			S: [{ p: { x: "a" } }, { p: { x: "a", k: 1 } }, { p: { x: "a", z: true, k: 1 } }, { p: "s" }],
		});
	});

	it("keeps a nested `@oneOf` whole, and its `null`, as the document nests them", () => {
		graded("d-r04", { A: [1], R: [{ p: 1 }], S: [{ p: 1 }, { p: 7 }], S2: [{ p: 1 }] });
		graded("d-r05", { S: [{ p: null }, { p: 1.5 }], S2: [{ q: null }, { q: 1 }] });
	});

	it("matches a literal repeated in a `@oneOf` once, and keeps a merged one exclusive", () => {
		graded("d-r06", {
			DupN: [1, "a"],
			DupS: ["x", 5],
			DupB: [true, 2],
			H: [{ n: 1, s: "x", b: true }],
		});
		// A literal narrowing into one is checked against the members the document publishes, once each.
		graded("d-r06", { S6: [{ p: 1 }, { p: 2 }] });
		graded("d-r07", { O1: ["b", "c"], S: [{ e: "b" }, { e: "c" }] });
	});

	it("makes a merged envelope's members optional under a PATCH, and exclusive", () => {
		graded("d-r08", {
			EV1Update: [{ kind: "v1" }],
			G1Update: [
				{ g: { kind: "v1" } },
				{ g: { value: { a: "s" } } },
				{ g: { kind: "v1", value: { a: "s" } } },
			],
		});
	});

	it("merges a list literal's element at `Item` beside a named list's at its own visibility", () => {
		graded("d-r09", {
			RUpdate: [{ u: [{ a: {} }] }],
			SUpdate: [{ u: [{ a: {} }] }, { u: [{ a: { x: "s" } }] }],
		});
	});

	it("refuses a spread and an explicit body of a model whose base holds a header, as openapi3 does", () => {
		// `HBase` and `HSub`, whose spread body openapi3 resolves to `HSub` itself: both are reported.
		expect(ours("d-r10")).toEqual(["error duplicate-declaration", "error duplicate-declaration"]);
		expect(ours("d-r12")).toEqual(["error duplicate-declaration", "error duplicate-declaration"]);
	});

	it("merges a member with no type as its keywords alone, beside an envelope", () => {
		expect(ours("d-r11")).toEqual([]);
		graded("d-r11", { S: [{ m: { e: { kind: "x", value: { b: 1 } } } }] });
	});

	it("validates `null | null` as the `null` it is", () => {
		expect(ours("d-r15")).toEqual([]);
		graded("d-r15", { M: [{ q: null }, { q: 1 }] });
	});

	it("says which collision a name is, and what a renamed discriminator publishes", () => {
		expect(message("d-co2", "duplicate-declaration")).toContain(
			"the name openapi3 gives 'Thing' at 'Create'",
		);
		expect(message("d-p4", "invalid-subtype-discriminator")).toContain(
			"the 'string' openapi3 adds",
		);
	});
});

describe("reading the wire", () => {
	it("reads a URL-encoded form's fields from text, and JSON as JSON", () => {
		expect(parsed("e-r1-urlencoded", "pBody", { n: "5", b: "true" })).toEqual({ n: 5, b: true });
		expect(parsed("e-r1-urlencoded", "pBody", { n: "x" })).toBe("refused");
	});

	it("reads a key as the declaration the validator holds it to, the subtype's", () => {
		expect(parsed("e-r2-redeclared", "sPath", { p: "x,5" })).toEqual({ p: { x: "5" } });
		expect(parsed("e-r2-redeclared", "sQuery", { q: "x,5" })).toEqual({ q: { x: "5" } });
		expect(parsed("e-r2-redeclared", "sQuery", { x: "5" })).toEqual({ e: { x: "5" } });
		expect(parsed("e-r2-redeclared", "sHeader", { h: "x,5" })).toEqual({ h: { x: "5" } });
		expect(parsed("e-r2-redeclared", "sCookie", { c: "x,5" })).toEqual({ c: { x: "5" } });
	});

	it("reads every other key as the indexer the chain enforces", () => {
		expect(parsed("e-r3-indexer", "sQuery", { q: "k,5" })).toEqual({ q: { k: 5 } });
		expect(parsed("e-r3-indexer", "sHeader", { h: "k,5" })).toEqual({ h: { k: 5 } });
		expect(parsed("e-r3-indexer", "sQuery", { q3: "k,5" })).toEqual({ q3: { k: 5 } });
	});

	it("boxes a lone value into a list only where a key repeats", () => {
		for (const [exported, key] of [
			["lmPath", "p"],
			["lmQuery", "q"],
			["lmHeader", "h"],
			["lmCookie", "c"],
		] as const) {
			expect(parsed("e-r4-boxing", exported, { [key]: "l,1" }), exported).toBe("refused");
		}
		expect(parsed("e-r4-boxing", "lmQuery", { r: "a,1" })).toBe("refused");
	});

	it("gathers one query key into every object parameter that declares it", () => {
		expect(parsed("e-r5-gatherers", "twoQuery", { a: "1" })).toEqual({
			f: { a: 1 },
			g: { a: 1 },
		});
		expect(parsed("e-r5-gatherers", "rmQuery", { a: "1" })).toEqual({ r: { a: "1" }, f: { a: 1 } });
		expect(parsed("e-r5-gatherers", "mrQuery", { a: "1" })).toEqual({ f: { a: 1 }, r: { a: "1" } });
	});

	it("reads any JSON value a mixed part's text spells", () => {
		expect(parsed("e-r6-mixedpart", "formSchema", { na: '"all"' })).toEqual({ na: "all" });
		expect(parsed("e-r6-mixedpart", "formSchema", { na: " 1" })).toEqual({ na: 1 });
		expect(parsed("e-r6-mixedpart", "formSchema", { mix: " 1" })).toEqual({ mix: 1 });
	});

	it("reads a discriminated header as the subtype its discriminator names", () => {
		expect(parsed("e-r10-discriminated", "hHeader", { pet: "kind,cat,x,5" })).toEqual({
			pet: { kind: "cat", x: "5" },
		});
		expect(parsed("e-r10-discriminated", "hCookie", { cpet: "kind,cat,x,5" })).toEqual({
			cpet: { kind: "cat", x: "5" },
		});
		// And `PDog`'s `x` read as its own number, where the base's table reads nothing.
		expect(parsed("e-r10-discriminated", "hHeader", { pet: "kind,dog,x,5" })).toEqual({
			pet: { kind: "dog", x: 5 },
		});
	});

	it("fills a default its own scalar's encoding writes, and names a default's real clash", () => {
		expect(ours("e-r8-scalardefault")).toEqual([]);
		expect(parsed("e-r8-scalardefault", "mSchema", {})).toEqual({ ts: 1577836800, secs: 5 });
		expect(message("e-r9-defaultmessage", "invalid-default")).toContain("it is no 'string'");
	});

	it("keeps a model named `SPEC_VOCABULARIES` apart from the vocabularies it imports", () => {
		expect(of("e-r7-specvocab").schemas.sPEC_VOCABULARIES_Schema).toBeDefined();
	});

	it("tells a collision a sanitised name makes from one a namespace makes", () => {
		expect(message("e-r11-names", "duplicate-declaration")).toContain("both declared as 'x_y'");
	});
});

describe("which reference openapi3 writes a component from, and its name", () => {
	it("reads a shared route's parameter as the one openapi3 publishes for its name", () => {
		expect(parsed("p-c6-sharedparamvis", "createQuery", { name: "n" })).toBe("refused");
		expect(parsed("p-c6-sharedparamvis", "createQuery", { c: "x", name: "n" })).toEqual({
			f: { c: "x", name: "n" },
		});
		expect(of("p-c6-sharedparamvis").schemas.filterACreateSchema).toBeDefined();
		expect(of("p-c1-sharedspread").schemas.commonBSchema).toBeDefined();
	});

	it("writes out a union instance openapi3 cannot name, and declares one it can", () => {
		expect(ours("p-u1-uinstexpr")).toEqual([]);
		expect(of("p-u1-uinstexpr").schemas.maybeSchema).toBeUndefined();
		expect(
			parsed("p-u1-uinstexpr", "holderSchema", { a: { x: "s" }, b: { y: 1 }, c: "lit" }),
		).toEqual({ a: { x: "s" }, b: { y: 1 }, c: "lit" });
		expect(of("p-u2-uinstsingle").schemas.maybeSchema).toBeUndefined();
	});

	it("validates a multipart part's raw `bytes` member as any value, as the document publishes it", () => {
		const file = {
			name: "f.bin",
			type: "application/octet-stream",
			arrayBuffer: async () => new ArrayBuffer(1),
		};
		expect(parsed("p-mp3-bytesunion", "form4Schema", { a: file, b: file, c: 1 })).not.toBe(
			"refused",
		);
		graded("p-c5-mpresp", { FileOrInner: [{}, { name: "s" }] });
		expect(message("p-c8-mpexpr", "duplicate-declaration")).toContain("multipart part");
	});

	it("names a declaration by its `@friendlyName`", () => {
		graded("p-n5-swap", { Dog: [{ bark: "s" }, { meow: 1 }], Cat: [{ meow: 1 }, { bark: "s" }] });
	});

	it("refuses a type published only as a reference to another document", () => {
		expect(ours("p-c2-useref")).toEqual(["error unsupported-type"]);
		expect(of("p-c2-useref").schemas.extSchema).toBeUndefined();
	});

	it("gives a refused union no envelope and no default variant openapi3 drops", () => {
		expect(ours("p-c3-envdefault")).toEqual(["error unsupported-type"]);
		expect(of("p-c3-envdefault").schemas.otherSchema).toBeUndefined();
	});

	it("says which of the ways two types became one name it is", () => {
		expect(message("p-n3-case", "duplicate-declaration")).toContain("first letter lowered");
		expect(message("p-n4-suffixcollide", "duplicate-declaration")).toContain(
			"suffixes for being used at more than one visibility",
		);
		expect(message("p-f1-maybedup", "duplicate-declaration")).toContain(
			"Two instances of the template",
		);
	});

	it("refuses a model sent as JSON and as a multipart form once, in either order, in a module that loads", () => {
		for (const name of ["p-mp4-jsonform", "p-mp4r"]) {
			expect(ours(name), name).toEqual(["error duplicate-declaration"]);
			expect(message(name, "duplicate-declaration"), name).toContain("multipart body");
			expect(of(name).schemas.formSchema, name).toBeDefined();
		}
	});
});
