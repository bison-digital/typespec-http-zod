import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { textToKeywordObj } from "typescript/unstable/ast/scanner";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../../support/compile-fixture.js";
import { typecheckEmitted } from "../../support/typecheck-emitted.js";

/**
 * **Declared names, each held to the document or the compiler.** A spec's text naming a library
 * type - `"Record<k>"` as a literal, a pattern, a default, a description - is the spec's own and
 * reaches the files as written; a declaration whose name TypeScript refuses, or a helper holds, is
 * renamed - judged on the whole name the document publishes, visibility suffix included; a list
 * openapi3 takes for a literal carries none of its own keywords. Components are graded by Ajv on
 * the document openapi3 publishes from the same program, sealed and open; a parameter by its
 * published schema.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

interface Document {
	readonly components?: { readonly schemas?: Record<string, { description?: string } & object> };
	readonly paths: Record<
		string,
		Record<
			string,
			{
				parameters?: { name: string; in: string; schema: object }[];
				requestBody?: { content: Record<string, { schema: object }> };
			}
		>
	>;
}

interface Loaded {
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
	readonly importError: string | undefined;
	readonly document: Document;
	readonly byDocument: (component: string, value: unknown) => boolean;
	readonly byParameter: (path: string, name: string, value: unknown) => boolean;
	readonly byBody: (path: string, value: unknown) => boolean;
}

const loaded = new Map<string, Loaded>();

async function load(dir: string, name: string, sealed: boolean, outDir?: string): Promise<Loaded> {
	const compiled = await compileFixture(dir, name, {
		...(outDir === undefined ? { outName: `${name}-${sealed ? "sealed" : "open"}` } : { outDir }),
		extraOptions: { "seal-object-schemas": sealed },
	});
	/**
	 * Caught, so a module that does not load fails its own assertion below rather than every fixture's:
	 * a declaration named `object` stopped the whole suite at the first import.
	 */
	let schemas: Record<string, ZodType> = {};
	let importError: string | undefined;
	try {
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	} catch (error) {
		importError = String(error);
	}
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		"seal-object-schemas": sealed,
	});
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as Document;
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	const byDocument = (component: string, value: unknown): boolean =>
		ajv.validate(
			{ $ref: `#/components/schemas/${component}`, components: document.components },
			value,
		);
	const byParameter = (path: string, name: string, value: unknown): boolean => {
		const operation = Object.values(document.paths[path] ?? {})[0];
		const parameter = operation?.parameters?.find((each) => each.name === name);
		if (parameter === undefined) throw new Error(`no parameter ${name} at ${path}`);
		return ajv.validate({ ...parameter.schema, components: document.components }, value);
	};
	const byBody = (path: string, value: unknown): boolean => {
		const schema = Object.values(document.paths[path] ?? {})[0]?.requestBody?.content[
			"application/json"
		]?.schema;
		if (schema === undefined) throw new Error(`no JSON body at ${path}`);
		return ajv.validate({ ...schema, components: document.components }, value);
	};
	return { compiled, schemas, importError, document, byDocument, byParameter, byBody };
}

const fixtures = readdirSync(here)
	.filter((file) => file.endsWith(".tsp"))
	.map((file) => file.slice(0, -".tsp".length));

/**
 * **Every keyword the TypeScript compiler this package builds with knows, read from its own scanner.**
 * Not a list written here: one typed out declares the words its author thought of, which is how the
 * reserved set came to be graded against itself and missed `as`, `yield`, `public` and `string`.
 */
const KEYWORDS = Object.keys(textToKeywordObj).toSorted();

/** The three declarations a spec can name after a keyword, each with a holder referring to it. */
const KEYWORD_SPECS = {
	model: (word: string) => `model \`${word}\` { a?: TypeSpec.int32; }`,
	enum: (word: string) => `enum \`${word}\` { a, b }`,
	union: (word: string) => `union \`${word}\` { TypeSpec.int32, TypeSpec.string }`,
} as const;

/** A spec declaring one `kind` per keyword, every one referred to by a property and a parameter. */
function writeKeywordSpec(kind: keyof typeof KEYWORD_SPECS): string {
	const dir = join(here, ".out", "keywords");
	mkdirSync(dir, { recursive: true });
	const declarations = KEYWORDS.map(KEYWORD_SPECS[kind]).join("\n");
	const properties = KEYWORDS.map((word, index) => `  p${index}?: \`${word}\`;`).join("\n");
	const operations = KEYWORDS.map(
		(word, index) => `@route("/q${index}") @get op q${index}(@query v?: \`${word}\`): Holder;`,
	).join("\n");
	writeFileSync(
		join(dir, `${kind}s.tsp`),
		`import "@typespec/http";\n\nusing Http;\n\n// GENERATED from TypeScript's own keyword table. Do not edit.\n@service(#{ title: "keyword ${kind}s" })\nnamespace Keyword${kind};\n\n${declarations}\n\nmodel Holder {\n${properties}\n}\n\n@route("/h") @post op h(@body body: Holder): Holder;\n${operations}\n`,
	);
	return dir;
}

/**
 * **The keywords `tsc` refuses as a declaration's name, measured, in each position the emitted files
 * write one**: an interface, a type alias, and a reference to each, in a module - strict mode, as
 * every emitted file is. One file per word and position, so one word's error cannot hide another's.
 *
 * **Measured until the compiler has nothing left to say**, because it reports a semantic error only
 * once no file has a syntactic one: `export type any` is `TS2457`, which went unreported for as long
 * as `export type public` was in the same program. A file refused is removed and the rest checked
 * again.
 */
function refusedByCompiler(): ReadonlySet<string> {
	const dir = join(here, ".out", "keywords-bare");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	KEYWORDS.forEach((word, index) => {
		const holder = `export interface Holder${index} { p?: ${word}; l?: ${word}[]; g?: ReadonlyArray<${word}> }\n`;
		writeFileSync(join(dir, `i${index}.ts`), `export interface ${word} { a?: number }\n${holder}`);
		writeFileSync(join(dir, `t${index}.ts`), `export type ${word} = { a?: number };\n${holder}`);
	});
	const refused = new Set<string>();
	for (;;) {
		const { output } = typecheckEmitted(dir);
		const files = new Set(
			[...output.matchAll(/(?:^|\/)([it]\d+\.ts)\(\d+,\d+\): error/gm)].map((m) => m[1] ?? ""),
		);
		if (files.size === 0) break;
		for (const file of files) {
			refused.add(KEYWORDS[Number(file.slice(1, -".ts".length))] ?? "");
			rmSync(join(dir, file));
		}
	}
	return refused;
}

let refused: ReadonlySet<string> = new Set();

beforeAll(async () => {
	for (const name of fixtures) {
		for (const sealed of [true, false]) {
			loaded.set(`${name}:${sealed}`, await load(here, name, sealed));
		}
	}
	for (const kind of Object.keys(KEYWORD_SPECS) as (keyof typeof KEYWORD_SPECS)[]) {
		const dir = writeKeywordSpec(kind);
		loaded.set(
			`keyword-${kind}s:true`,
			await load(dir, `${kind}s`, true, join(here, ".out", `keyword-${kind}s`)),
		);
	}
	refused = refusedByCompiler();
}, 900_000);

const of = (name: string, sealed = true): Loaded => {
	const found = loaded.get(`${name}:${sealed}`);
	if (found === undefined) throw new Error(`no fixture ${name}`);
	return found;
};

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

/** Every value graded against the document's component, in both seal modes. */
function graded(name: string, cases: Record<string, readonly unknown[]>, exported?: string): void {
	for (const sealed of [true, false]) {
		const fixture = of(name, sealed);
		for (const [component, values] of Object.entries(cases)) {
			const schema = fixture.schemas[exported ?? `${lowerFirst(component)}Schema`];
			expect(schema, `${name} ${component}`).toBeDefined();
			for (const value of values) {
				expect(
					schema?.safeParse(value).success,
					`${name} sealed=${sealed} ${component} ${JSON.stringify(value)}`,
				).toBe(fixture.byDocument(component, value));
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

const emitted = (name: string, file: string): string =>
	readFileSync(join(of(name).compiled.outDir, file), "utf8");

describe("every naming fixture's emitted set", () => {
	it("loads and typechecks, the wire contract included, sealed and open", () => {
		for (const key of loaded.keys()) {
			const [name = "", sealed] = key.split(":");
			const fixture = of(name, sealed === "true");
			expect(fixture.importError, key).toBeUndefined();
			const { output, failed } = typecheckEmitted(fixture.compiled.outDir);
			expect(output, key).toBe("");
			expect(failed, key).toBe(false);
		}
	});
});

describe("a spec's text naming a library type is the spec's own", () => {
	it("keeps a literal, a pattern, a default and a description as written beside a model `Record`", () => {
		const name = "record-literals";
		graded(name, {
			M: [
				{ k: "Record<k>" },
				{ k: "globalThis.Record<k>" },
				{ p: "Record<ab>" },
				{ p: "globalThis.Record<ab>" },
				{},
			],
		});
		const document = of(name).document.components?.schemas?.M as {
			description?: string;
			properties: { d: { default: unknown } };
		};
		expect(parsed(name, "mSchema", {})).toEqual({ d: document.properties.d.default });
		expect(of(name).schemas.mSchema?.description).toBe(document.description);
		expect(emitted(name, "requests.gen.ts")).toContain('k?: "Record<k>";');
	});

	it("keeps an enum's value, a query literal, a literal and a pattern apart from the library's names", () => {
		const name = "library-literals";
		graded(name, {
			M: [
				{ e: "Record<int32>" },
				{ e: "globalThis.Record<int32>" },
				{ l: "Promise<x>" },
				{ l: "globalThis.Promise<x>" },
				{ p: "Readonly<ab>" },
				{ p: "globalThis.Readonly<ab>" },
				{},
			],
		});
		for (const q of ["Record<q>", "globalThis.Record<q>"]) {
			expect(parsed(name, "aQuery", { q }) !== "refused", q).toBe(
				of(name).byParameter("/a", "q", q),
			);
		}
		expect(parsed(name, "mSchema", {})).toEqual({ d: "Exclude<y>" });
		// The enum's value in its vocabulary, its validator and its contract type alike.
		expect(emitted(name, "requests.gen.ts")).toContain('"Record<int32>" | "x"');
	});

	it("keeps them beside a model `Exclude` and a model `Promise`, in a header too", () => {
		const name = "exclude-promise-literals";
		graded(name, {
			M: [{ l: "Promise<z>" }, { l: "globalThis.Promise<z>" }, {}],
			Exclude: [{ a: 1 }, {}],
			Promise: [{ a: 1 }, { a: "x" }],
		});
		expect(parsed(name, "mSchema", {})).toEqual({ d: "Exclude<y>" });
		for (const h of ["Promise<h>", "globalThis.Promise<h>"]) {
			expect(parsed(name, "aHeader", { h }) !== "refused", h).toBe(
				of(name).byParameter("/a", "h", h),
			);
		}
	});

	it("names every library generic it writes through `globalThis`, where a model of its name is declared", () => {
		const name = "library-sites";
		for (const exported of ["recordSchema", "promiseSchema", "readonlySchema", "excludeSchema"]) {
			expect(of(name).schemas[exported], exported).toBeDefined();
		}
		graded(name, {
			Holder: [
				{ rec: { a: 1 }, pr: { p: "x" }, ro: { r: "x" }, ex: { e: true } },
				{ rec: { a: 1 }, pr: { p: "x" }, ro: { r: "x" }, ex: { e: true }, counts: { k: 1 } },
				{ rec: { a: 1 }, pr: { p: "x" }, ro: { r: "x" }, ex: { e: true }, anything: { k: 1 } },
				{ rec: { a: "x" }, pr: { p: "x" }, ro: { r: "x" }, ex: { e: true } },
			],
		});
		expect(parsed(name, "gatherQuery", { x: "5" })).toEqual({ f: { x: 5 } });
		expect(parsed(name, "eitherQuery", { kind: "b", m: "true" })).toEqual({
			u: { kind: "b", m: true },
		});
		const requests = emitted(name, "requests.gen.ts");
		expect(requests).toContain("none: globalThis.Record<string, never>;");
		expect(requests).toContain("counts?: globalThis.Record<string, number>;");
		expect(requests).toContain("arrayBuffer: () => globalThis.Promise<ArrayBuffer>");
		expect(emitted(name, "schemas.gen.ts")).toContain(
			"globalThis.Readonly<globalThis.Record<string, WireReader>>",
		);
	});
});

describe("a declaration TypeScript refuses the name of", () => {
	it("measured the compiler's own keywords, and found it refusing some and accepting others", () => {
		// Non-vacuity: a table that stopped being read would grade nothing and pass.
		expect(KEYWORDS.length).toBeGreaterThan(80);
		expect(refused.size).toBeGreaterThan(50);
		expect(refused.size).toBeLessThan(KEYWORDS.length);
		for (const word of ["public", "string", "keyof", "yield", "as", "delete"]) {
			expect(refused.has(word), word).toBe(true);
		}
	});

	it("renames exactly the keywords the compiler refuses, as a model, an enum and a union", () => {
		for (const kind of Object.keys(KEYWORD_SPECS)) {
			const requests = emitted(`keyword-${kind}s`, "requests.gen.ts");
			const renamed = KEYWORDS.filter((word) =>
				new RegExp(`^export (?:interface|type) ${word}_\\b`, "m").test(requests),
			);
			const bare = KEYWORDS.filter((word) =>
				new RegExp(`^export (?:interface|type) ${word}\\b(?!_)`, "m").test(requests),
			);
			expect(renamed, kind).toEqual(KEYWORDS.filter((word) => refused.has(word)));
			expect(bare, kind).toEqual(KEYWORDS.filter((word) => !refused.has(word)));
		}
	});

	it("validates each as the document does, under the renamed validator", () => {
		graded("refused-names", { All: [{ p16: { a: 1 } }, { p16: { a: "x" } }, { p0: {} }] });
		graded("type-operators", { All: [{ p0: { a: 1 } }, { p3: { a: "x" } }] });
		graded("refused-enum-union", { Holder: [{ v: "a" }, { v: "c" }, { o: 1 }, { o: true }] });
		for (const [name, component, exported] of [
			["refused-names", "public", "public_Schema"],
			["refused-names", "any", "any_Schema"],
			["type-operators", "keyof", "keyof_Schema"],
			["refused-enum-union", "object", "object_Schema"],
		] as const) {
			graded(name, { [component]: [{ a: 1 }, 1, "a"] }, exported);
		}
		// The vocabulary keeps the enum's own name, a property key any word may be.
		expect(emitted("refused-enum-union", "vocabularies.gen.ts")).toContain('public: ["a", "b"]');
	});
});

describe("a name renamed with a trailing `_`, decided on the name the document publishes", () => {
	it("keeps the document's name for a visibility view whose bare name a helper holds", () => {
		const name = "suffixed-helper-name";
		const components = Object.keys(of(name).document.components?.schemas ?? {});
		expect(components).toContain("WireReader");
		expect(components).toContain("WireReaderUpdate");
		// `WireReader` is a helper the files declare; `WireReaderUpdate` is a name nothing else holds.
		expect(of(name).schemas.wireReader_Schema).toBeDefined();
		expect(of(name).schemas.wireReaderUpdateSchema).toBeDefined();
		expect(of(name).schemas.wireReader_UpdateSchema).toBeUndefined();
		expect(emitted(name, "requests.gen.ts")).toMatch(/^export interface WireReaderUpdate \{/m);
		graded(name, {
			WireReaderUpdate: [{}, { x: {} }, { x: { p: { a: "s" } } }, { x: { p: { a: 1 } } }],
		});
	});

	it("renames a multipart body and an envelope by the same rule, no type standing for either", () => {
		const name = "refused-multipart";
		expect(of(name).schemas.public_Schema).toBeDefined();
		expect(emitted(name, "requests.gen.ts")).toMatch(/^export interface public_ \{/m);
		// The envelope `Wire` + `inputs`, beside the lookup of that name, which it used to merge into.
		expect(of(name).schemas.wireInputs_Schema).toBeDefined();
		const lookup = /^export interface WireInputs \{([\s\S]*?)\n\}/m.exec(
			emitted(name, "requests.gen.ts"),
		)?.[1];
		expect(lookup).toBeDefined();
		expect(lookup).not.toMatch(/kind: "inputs"/);
		graded(
			name,
			{ WireInputs: [{ kind: "inputs", value: { a: 1 } }, { kind: "x" }] },
			"wireInputs_Schema",
		);
	});
});

describe("a list model named `Array`, which openapi3 takes for a list literal", () => {
	it("carries none of its own keywords, wherever it is used, as the document publishes none", () => {
		const name = "array-literal-model";
		graded(name, {
			H: [
				{ a: [] },
				{ a: [1] },
				{ a: [1, 2, 3, 4] },
				{ b: [1] },
				{ b: [1, 2] },
				{ b: [1, 2, 3, 4] },
				{ t: [] },
				{ t: [1, 2, 3, 4] },
				{ t: [1] },
			],
		});
		// Read from the wire as the document reads it - comma-separated numbers - then held to its schema.
		for (const [wire, list] of [
			["1", [1]],
			["1,2,3,4", [1, 2, 3, 4]],
		] as const) {
			for (const [exported, parameter] of [
				["aQuery", "q"],
				["aHeader", "h"],
			] as const) {
				expect(parsed(name, exported, { [parameter]: wire }), `${parameter} ${wire}`).toEqual(
					of(name).byParameter("/a", parameter, list) ? { [parameter]: list } : "refused",
				);
			}
		}
		for (const value of [[], [1], [1, 2, 3, 4]]) {
			for (const exported of ["bBody", "bResponse200"]) {
				expect(
					parsed(name, exported, value) !== "refused",
					`${exported} ${JSON.stringify(value)}`,
				).toBe(of(name).byBody("/b", value));
			}
		}
		// The property's own description is published; the list's is not.
		const shape = (of(name).schemas.hSchema as unknown as { shape: Record<string, ZodType> }).shape;
		const published = of(name).document.components?.schemas?.H as {
			properties: Record<string, { description?: string }>;
		};
		for (const property of ["a", "b"]) {
			expect(shape[property]?.description, property).toBe(
				published.properties[property]?.description,
			);
		}
	});
});
