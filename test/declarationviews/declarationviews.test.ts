import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Where openapi3 reads a declaration's properties, and what a merge keeps, each held to the
 * document.** Every fixture is a minimal spec - `d-` for inheritance, merges, discrimination and
 * visibility, `p-` for which reference openapi3 writes a component from and what the messages tell
 * an author to do - compiled sealed and open, and graded by Ajv on the document openapi3 publishes
 * from the same program. Where the emitter answers with a refusal, the validator is held only to
 * accepting nothing the document refuses: what it refuses beyond that is the cost the diagnostic
 * names.
 *
 * Reading parameters is in `params/`.
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
}, 1_800_000);

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

/** Every message of this emitter's diagnostics of a code. */
const messages = (name: string, code: string, sealed = true): string[] =>
	of(name, sealed)
		.compiled.program.diagnostics.filter((d) => d.code === `typespec-http-zod/${code}`)
		.map((d) => d.message);

/** The validator a component is exported as, and its verdict on a value. */
function verdictOf(fixture: Loaded, component: string, value: unknown): boolean {
	const schema = fixture.schemas[`${lowerFirst(component)}Schema`];
	expect(schema, component).toBeDefined();
	return schema?.safeParse(value).success ?? false;
}

/** Every value graded against the document, in both seal modes unless `sealedOnly`. */
function graded(name: string, cases: Record<string, readonly unknown[]>, sealedOnly = false): void {
	for (const sealed of sealedOnly ? [true] : [true, false]) {
		const fixture = of(name, sealed);
		for (const [component, values] of Object.entries(cases)) {
			for (const value of values) {
				expect(
					verdictOf(fixture, component, value),
					`${name} sealed=${sealed} ${component} ${JSON.stringify(value)}`,
				).toBe(fixture.byDocument(component, value));
			}
		}
	}
}

/** No value accepted that the document refuses - where a refusal leaves the validator stricter. */
function noLooser(name: string, cases: Record<string, readonly unknown[]>): void {
	for (const sealed of [true, false]) {
		const fixture = of(name, sealed);
		for (const [component, values] of Object.entries(cases)) {
			for (const value of values) {
				if (!verdictOf(fixture, component, value)) continue;
				expect(
					fixture.byDocument(component, value),
					`${name} sealed=${sealed} ${component} accepts ${JSON.stringify(value)}`,
				).toBe(true);
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

describe("a declaration where openapi3 reads its model's properties", () => {
	it("holds a read-only key to what the published schema declares in its place", () => {
		graded("d-readonly-elsewhere", {
			X: [{ name: "n", id: "ab" }, { name: "n", id: "abcdef" }, { name: "n" }],
			Z: [
				{ name: "n", id: "abc" },
				{ name: "n", id: "zz" },
			],
			Sub4: [
				{ name: "n", id: "ab" },
				{ name: "n", id: "abcdef" },
			],
			P: [
				{ kind: "q", name: "n" },
				{ kind: "qq", name: "n" },
			],
			Qq: [{ kind: "qq", name: "n" }],
		});
		// `Base4` declares nothing in place of its own read-only `id`: still refused, and alone.
		expect(ours("d-readonly-elsewhere")).toEqual(["error split-visibility"]);
	});

	it("holds an indexer's, a base's and the added discriminator's key to what declares it", () => {
		graded("p-indexer-holds", {
			M: [
				{ id: "a", code: "ab", name: "n" },
				{ id: 5, code: "ab", name: "n" },
				{ id: "a", code: "abcdef", name: "n" },
				{ id: "a", code: 7, name: "n" },
				{ name: "n" },
			],
		});
		graded("p-base-holds", {
			D: [
				{ code: "abc", name: "n" },
				{ code: 5, name: "n" },
				{ code: "abcdef", name: "n" },
				{ name: "n" },
			],
		});
		graded("p-discriminator-holds", {
			Pet: [
				{ kind: "cat", name: "n" },
				{ kind: "zzz", name: "n" },
				{ kind: "dog", name: "n" },
				{ name: "n" },
			],
		});
		// The added discriminator is the base's, and no component of its own.
		expect(names("p-discriminator-holds").extra).toEqual([]);
	});

	it("says a subtype's fixed discriminator is not visible where openapi3 reads it", () => {
		const said = messages("p-subtype-tag-hidden", "invalid-subtype-discriminator").join("\n");
		expect(said).toContain(
			"its 'kind' is not visible at 'Create', where openapi3 reads the properties of 'Cat'",
		);
		expect(said).toContain("Make 'kind' visible at 'Create' on 'Cat'");
		expect(said).not.toContain("Declare 'kind' on 'Cat' as one fixed value");
		const invisible = messages("d-invisible-tag-message", "invalid-subtype-discriminator").join(
			"\n",
		);
		expect(invisible).toContain("its 'kind' is not visible at 'Create'");
		expect(invisible).not.toContain("Declare 'kind' on 'QC' as one fixed value");
		noLooser("p-subtype-tag-hidden", {
			Cat: [
				{ kind: "cat", name: "n" },
				{ kind: "dog", name: "n" },
			],
			Pet: [
				{ kind: "cat", name: "n" },
				{ kind: "dog", name: "n" },
				{ kind: "zzz", name: "n" },
			],
		});
	});

	it("is not split where a base, as its own schema publishes it, declares the key", () => {
		graded("p-base-declares", {
			IRB: [{ id: "a", name: "n" }, { name: "n" }, { id: "a" }],
			Outer: [
				{ secret: "s", v: { id: "a", name: "n" } },
				{ secret: "s", v: { name: "n" } },
			],
		});
		graded("p-base-declares-dropped", {
			S: [{ name: "n", k: "k" }, { name: "n" }, { name: "n", k: 5 }],
		});
		expect(ours("p-base-declares")).toEqual([]);
		expect(ours("p-base-declares-dropped")).toEqual([]);
	});

	it("is not split where a subtype declares the optional key its base drops", () => {
		graded("p-subtype-redeclares-dropped", {
			IDR: [{ id: "a", name: "n", x: "x" }, { name: "n", x: "x" }, { name: "n" }],
		});
		// The base drops `id` with nothing in its place: refused, and only it.
		expect(ours("p-subtype-redeclares-dropped")).toEqual(["error split-visibility"]);
	});
});

describe("a merge that keeps what each declaration says", () => {
	it("leaves out a null a declaration above refuses, inside a @oneOf member", () => {
		graded("d-oneof-null-merge", { L: [{ c: null }, { c: "x" }, { c: "y" }, { c: "z" }] });
	});

	it("holds a literal member to the check its declared scalar emits", () => {
		graded("d-oneof-scalar-merge", {
			// A `utcDateTime` is checked as one, which the document leaves to `format`: no other string.
			Sub: [{ k: "red" }, { k: "green" }, { k: "2020-01-01T00:00:00Z" }],
		});
		graded("d-literal-width-merge", {
			Leaf: [
				{ g: 300, h: "2020-01-01T00:00:00Z" },
				{ g: 1, h: "red" },
				{ g: 1, h: "2020-01-01T00:00:00Z" },
			],
		});
	});

	it("publishes a merged envelope where its union reduces to, not at the PATCH", () => {
		graded("d-envelope-merge-patch", {
			Mid: [
				{ k: { kind: "a" } },
				{ k: { kind: "b" } },
				{ k: {} },
				{ k: { kind: "a", value: {} } },
				{},
			],
		});
	});

	it("keeps a nested @discriminated union whole", () => {
		const values = [
			{ q: {} },
			{ q: { kind: "a" } },
			{ q: { x: "s" } },
			{ e: {} },
			{ e: { value: {} } },
			{ e: { kind: "a" } },
			{ e: { kind: "a", value: {} } },
			{ q: true },
		];
		graded("d-nested-discriminated", {
			LUpdate: values,
			L: values.map((value) => ({ ...value, r: "r" })),
		});
	});

	it("narrows into a discriminated variant only where its discriminator tells it apart", () => {
		graded("d-narrow-optional-tag-patch", {
			SUpdate: [{ u: {} }, { u: { kind: "a" } }, { u: { x: "s" } }, { u: { y: 1 } }],
		});
		graded("d-narrow-optional-tag", {
			S: [
				{ u: {}, v: true },
				{ u: { kind: "a" }, v: {} },
				{ u: { kind: "a" }, v: { kind: "a" } },
			],
		});
	});

	it("keeps a variant whose refused discriminator a PATCH lets it leave out", () => {
		graded("d-dropped-variant-patch", {
			RUpdate: [
				{ u: {} },
				{ u: { z: "s" } },
				{ u: { x: "s" } },
				{ u: { kind: "asp" } },
				{ u: { kind: "cobra" } },
				{ u: { n: "s" } },
			],
		});
	});

	it("validates nothing for a @oneOf holding a refused member, and says why", () => {
		const values = [{ o: {} }, { o: { c: "s" } }, { o: { id: "i" } }, { o: { id: "i", c: 1 } }];
		noLooser("d-oneof-split-member", { Outer: values, OuterCreate: values });
		noLooser("d-oneof-refused-merge", {
			LeafB: [{ u: { b: [], d: "a" } }, { u: { d: "a" } }, { u: { b: [1, "x"], d: "a" } }],
		});
		// The declaration a value is merged into reports it, not the members it is merged from.
		// Open, where `M3` takes the `d` that makes the two members overlap.
		const refused = messages("d-oneof-refused-merge", "unrepresentable-override", false).join("\n");
		expect(refused).toContain("'LeafB' redeclares 'u', which 'RootB' declares as 'O2'");
		expect(refused).not.toContain("'M5' redeclares 'b'");
	});

	it("holds a merged list literal's element at Item, as the document does", () => {
		graded("d-named-list-patch", {
			LeafBUpdate: [{ u: [{ a: {} }] }, { u: [{ a: { d: 1 } }] }, { u: [{}] }],
		});
		expect(names("d-named-list-patch").extra).toEqual([]);
	});

	it("reads a key one merged model declares where that model is published", () => {
		graded("d-merge-patch-only", {
			LeafB: [{ u: { c: {} } }, { u: { c: { b: "s" } } }, { u: { c: { x: 1 } } }],
		});
	});

	it("writes a member repeated in an anyOf once, on both sides of the wire assertion", () => {
		expect(emitted("d-repeated-member", "schemas.gen.ts")).not.toMatch(
			/z\.union\(\[(z\.object\(\{\}\)\.catchall\(m19CreateSchema\)), \1\]\)/,
		);
	});

	it("annotates a record under a PATCH with the view its value is published at", () => {
		expect(emitted("d-record-item-view", "schemas.gen.ts")).not.toContain("M4Update");
	});
});

describe("which reference openapi3 writes a component from", () => {
	it("follows a reference to a union variant at the request's visibility", () => {
		graded("p-variant-patch", {
			W: [{ v: { name: "n" } }, { v: { id: "a", name: "n" } }, {}, { v: {} }],
		});
		expect(names("p-variant-patch")).toEqual({ missing: [], extra: [] });
		expect(ours("p-variant-split")).toEqual(["error split-visibility"]);
		noLooser("p-variant-split", { Inner: [{ id: "a", name: "n" }, { name: "n" }] });
	});

	it("holds a base published at two visibilities under one name to the one the document keeps", () => {
		// `K` at `All`, from the pass over unreached types, and at `Read`, from `P`'s mapping: `Read` is kept.
		graded("p-kept-base", {
			G: [
				{ kind: "c", g: "x" },
				{ kind: "c", g: "x", s: "y" },
			],
			K: [{ kind: "c" }, { kind: "c", s: "y" }],
		});
		expect(ours("p-kept-base")).toEqual([]);
	});

	it("publishes a shared route's parameter optional whichever emitter runs first", async () => {
		expect(parsed("p-shared-route-optional", "saQuery", { other: "x" })).toEqual({});
		expect(parsed("p-shared-route-optional", "saQuery", {})).toEqual({});
		/**
		 * openapi3 sets `optional` on the declarations as it emits, so the order is the variable: the
		 * fixture above ran this emitter alone, and this compile runs openapi3 first.
		 */
		const outDir = join(here, ".out", "p-shared-route-optional-after-openapi3");
		const program = await compile(NodeHost, join(here, "p-shared-route-optional.tsp"), {
			outputDir: outDir,
			emit: ["@typespec/openapi3", "typespec-http-zod"],
			options: {
				"@typespec/openapi3": { "emitter-output-dir": outDir, "openapi-versions": ["3.1.0"] },
				"typespec-http-zod": { "emitter-output-dir": outDir, "seal-object-schemas": true },
			},
		});
		expect(program.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		const declaration = (text: string): string | undefined =>
			/export const saQuery = [^;]*;/.exec(text)?.[0];
		expect(declaration(readFileSync(join(outDir, "schemas.gen.ts"), "utf8"))).toBe(
			declaration(emitted("p-shared-route-optional", "schemas.gen.ts")),
		);
	});
});

describe("a remedy that works where it is pasted", () => {
	it("names a view declared as a model of its own, sent through @body, by its full name", () => {
		expect(messages("p-remedy-friendly", "split-visibility").join("\n")).toContain(
			"declare 'model OuterCreate is Create<M2.Outer>;' and send it as the request body of 'create', through '@body'",
		);
		const spread = messages("p-remedy-spread-sub", "split-visibility").join("\n");
		expect(spread).toContain("declare 'model O1Create is Create<R7.O1>;'");
		expect(spread).toContain("declare 'model O3Create is Create<R7.Sub.O3>;'");
	});

	it("compiles clean once each remedy is applied as written", () => {
		for (const name of [
			"p-remedy-friendly-applied",
			"p-remedy-collision-applied",
			"p-remedy-spread-sub-applied",
		]) {
			expect(ours(name), name).toEqual([]);
		}
	});
});
