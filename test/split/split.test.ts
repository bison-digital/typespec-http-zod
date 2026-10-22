import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A schema `@typespec/openapi3` publishes with its properties and its `required` read at two
 * visibilities is refused, and only such a schema.** See `split.tsp`, and `publicationOf` in
 * `src/published.ts` for the mechanism.
 *
 * openapi3 writes a component from the first reference that reaches it. Reached first from a
 * request with nothing to reshape in it, the component's `required` is read at `Read` and its
 * properties at the request's visibility, and every response shares that schema: `InnerA` is
 * published as `required: [id, name]`, `properties: {name}`, which no value satisfies under
 * `seal-object-schemas`. Validated as the model declares it, a response carrying `id` passed here
 * and failed the document; validated as the document says, nothing passed. So it is refused. The
 * graded set comes from the document itself, so a case the emitter misses or refuses wrongly shows
 * up as a difference against openapi3, not against a list written here.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

interface Schema {
	readonly required?: readonly string[];
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly [key: string]: unknown;
}

interface Loaded {
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
	readonly document: {
		readonly components: { readonly schemas: Readonly<Record<string, Schema>> };
		readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	};
	readonly byDocument: (component: string, value: unknown) => boolean;
}

async function load(name: string): Promise<Loaded> {
	const compiled = await compileFixture(here, name, { outName: name });
	const schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
		string,
		ZodType
	>;
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		"seal-object-schemas": true,
	});
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as Loaded["document"];
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	const byDocument = (component: string, value: unknown): boolean =>
		ajv.validate(
			{ $ref: `#/components/schemas/${component}`, components: document.components },
			value,
		);
	return { compiled, schemas, document, byDocument };
}

let split: Loaded;
let fixed: Loaded;
let contexts: Loaded;

beforeAll(async () => {
	[split, fixed, contexts] = await Promise.all([load("split"), load("fixed"), load("contexts")]);
}, 300_000);

/**
 * Where the document publishes a schema whose `required` names a key its `properties` do not
 * declare: a component's own schema by its name, and a schema written out inside one - a model
 * expression - or inside an operation as `where:inline`, where `where` is the component or `VERB
 * /path`.
 */
function splitSchemasOf(document: Loaded["document"]): string[] {
	const found = new Set<string>();
	const visit = (schema: unknown, where: string, own: boolean): void => {
		if (schema === null || typeof schema !== "object") return;
		if (Array.isArray(schema)) {
			for (const each of schema) visit(each, where, false);
			return;
		}
		const object = schema as Schema;
		if (Array.isArray(object.required)) {
			const declared = Object.keys(object.properties ?? {});
			if (object.required.some((key) => !declared.includes(key))) {
				found.add(own ? where : `${where}:inline`);
			}
		}
		for (const value of Object.values(object)) visit(value, where, false);
	};
	for (const [name, schema] of Object.entries(document.components.schemas))
		visit(schema, name, true);
	for (const [path, operations] of Object.entries(document.paths)) {
		for (const [verb, operation] of Object.entries(operations)) {
			visit(operation, `${verb.toUpperCase()} ${path}`, false);
		}
	}
	return [...found].toSorted();
}

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

/**
 * The component each `split-visibility` names - the one it publishes split, or the one holding such
 * a base - or `inline` for a model expression.
 */
function refusedIn(loaded: Loaded): string[] {
	return loaded.compiled.program.diagnostics
		.filter((d) => d.code === "typespec-http-zod/split-visibility")
		.map(
			(d) =>
				/^'@typespec\/openapi3' publishes '([^']+)'/.exec(d.message)?.[1] ??
				/^'([^']+)' holds /.exec(d.message)?.[1] ??
				"inline",
		)
		.toSorted();
}

describe("a schema openapi3 publishes with its properties read at a request's visibility", () => {
	it("is refused, each once, as an error", () => {
		const others = split.compiled.program.diagnostics
			.filter((d) => d.severity === "error" && d.code !== "typespec-http-zod/split-visibility")
			.map((d) => `${d.code}: ${d.message}`);
		expect(others).toEqual([]);
		expect(refusedIn(split)).toEqual([
			"BaseK",
			"DeepD",
			/**
			 * Held to `BaseK` through `allOf` - its create body, `DerivedKCreate`, as well as `DerivedK` -
			 * and reported once, at the declaration, naming the first of them.
			 */
			"DerivedKCreate",
			"I1G",
			"I2G",
			"I3M",
			"I5M",
			"InnerA",
			"InnerC",
			"InnerI",
			"InnerJ",
			"InnerN",
			"InnerS",
			// The model expression in `OuterV` and the one in `createV2`'s body, each written out split.
			"inline",
			"inline",
		]);
	});

	it("is every schema the document publishes with a required key it does not declare", () => {
		const published = splitSchemasOf(split.document);
		// Pinned, so an oracle that found nothing would fail here rather than agree with anything.
		expect(published).toEqual([
			"BaseK",
			"DeepD",
			"I1G",
			"I2G",
			"I3M",
			"I5M",
			"InnerA",
			"InnerC",
			"InnerI",
			"InnerJ",
			"InnerS",
			"OuterV:inline",
			"POST /v2:inline",
		]);
		const refused = refusedIn(split);
		const components = published.filter((where) => !where.endsWith(":inline"));
		expect(components.filter((name) => !refused.includes(name))).toEqual([]);
		expect(refused.filter((name) => name === "inline")).toHaveLength(
			published.length - components.length,
		);
	});

	it("is the component that leaves an optional read-only property out, which a sealed response refuses", () => {
		const inner = split.document.components.schemas.InnerN;
		expect(Object.keys(inner?.properties ?? {})).toEqual(["name"]);
		expect(split.byDocument("InnerN", { id: "1", name: "n" })).toBe(false);
		expect(refusedIn(split)).toContain("InnerN");
	});

	it("emits a validator for it that accepts nothing", () => {
		for (const name of refusedIn(split).filter((each) => each !== "inline")) {
			const schema = split.schemas[`${lowerFirst(name)}Schema`];
			expect(schema, name).toBeDefined();
			for (const value of [{ id: "1", name: "n" }, { name: "n" }, {}]) {
				expect(schema?.safeParse(value).success, `${name} ${JSON.stringify(value)}`).toBe(false);
			}
		}
	});

	it("leaves every other component validating as the document does", () => {
		const refused = refusedIn(split);
		const graded = Object.keys(split.document.components.schemas).filter(
			(name) => !refused.includes(name),
		);
		expect(graded).toEqual(
			expect.arrayContaining(["InnerB", "I3G", "I4G", "CatQ", "InnerO", "InnerP", "MidD"]),
		);
		const values: unknown[] = [
			{ id: "1", name: "n" },
			{ name: "n" },
			{ id: "1", name: "n", extra: true },
			{ kind: "cat", id: "1", name: "n" },
			{ deep: { id: "1", name: "n" }, m: "m" },
		];
		for (const name of graded) {
			const schema = split.schemas[`${lowerFirst(name)}Schema`];
			expect(schema, name).toBeDefined();
			for (const value of values) {
				expect(schema?.safeParse(value).success, `${name} ${JSON.stringify(value)}`).toBe(
					split.byDocument(name, value),
				);
			}
		}
	});

	it("names the request's own view as the remedy", () => {
		const messages = split.compiled.program.diagnostics
			.filter((d) => d.code === "typespec-http-zod/split-visibility")
			.map((d) => d.message);
		expect(messages).toContain(
			"'@typespec/openapi3' publishes 'InnerA' as the request body of 'createA' first reaches it: there it reads the properties of 'InnerA' at 'Create' and its 'required' at 'Read', so 'id' is required and not declared, in every use of 'InnerA'. Refused rather than validated against a schema the document does not hold. Use the request's own view, which openapi3 publishes apart: declare 'model OuterACreate is Create<Split.OuterA>;' and send it as the request body of 'createA', through '@body', or move 'id' out of 'InnerA'.",
		);
		expect(messages).toContain(
			"'@typespec/openapi3' publishes this model expression with its properties read at 'Create' and its 'required' at 'Read', so 'id' is required and not declared. Refused rather than validated against a schema the document does not hold. Use the request's own view, which openapi3 publishes apart: declare it as a named model and send its 'Create<...>' view in its place, or move 'id' out of this model expression.",
		);
		const text = messages.join("\n");
		for (const remedy of [
			"so 'id' is not declared, in every use of 'InnerN'",
			"'DerivedKCreate' holds 'BaseK' through 'allOf', and '@typespec/openapi3' publishes 'BaseK' as the request body of 'createK' first reaches it",
			"the properties of 'DeepD' at 'Create'",
			"declare 'model OuterDCreate is Create<Split.OuterD>;' and send it as the request body of 'createD', through '@body'",
			"send each model in the request body of 'createI' as its 'Create<...>' view",
			"at 'CreateOrUpdate'",
			"declare 'model OuterJCreateOrUpdate is CreateOrUpdate<Split.OuterJ>;' and send it as the request body of 'replaceJ', through '@body'",
			"declare 'model DerivedKCreate is Create<Split.DerivedK>;' and send it as the request body of 'createK', through '@body'",
			"publishes this model expression with its properties read at 'Create'",
		]) {
			expect(text).toContain(remedy);
		}
	});

	it("is published apart and consistent once the request sends that view, and is not refused", () => {
		expect(fixed.compiled.program.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(splitSchemasOf(fixed.document)).toEqual([]);
		expect(Object.keys(fixed.document.components.schemas.InnerN?.properties ?? {})).toEqual([
			"id",
			"name",
		]);
		for (const name of ["CreateInnerA", "CreateDeepD", "CreateDerivedK", "InnerB", "InnerN"]) {
			const schema = fixed.schemas[`${lowerFirst(name)}Schema`];
			expect(schema, name).toBeDefined();
			for (const value of [{ id: "1", name: "n" }, { name: "n" }]) {
				expect(schema?.safeParse(value).success, `${name} ${JSON.stringify(value)}`).toBe(
					fixed.byDocument(name, value),
				);
			}
		}
	});
});

describe("a component openapi3 writes twice, inside an explicit `@body` and outside one", () => {
	/**
	 * openapi3 keys a component on the metadata context too, so a model under an explicit `@body`
	 * whose type carries metadata annotations is a second declaration of the same name: it reports
	 * `duplicate-type-name`, and `components.schemas` holds the one written last. That is the one
	 * judged here - `InnerX1`'s misread request schema is overwritten by its response's, `InnerX2`'s
	 * response schema by its misread request's.
	 */
	it("is judged by the one openapi3 publishes, the last it writes", () => {
		expect(refusedIn(contexts)).toEqual(["InnerX2"]);
		expect(splitSchemasOf(contexts.document)).toEqual(["InnerX2"]);
		const openapi3 = contexts.compiled.program.diagnostics
			.filter((d) => d.severity === "error" && !d.code.startsWith("typespec-http-zod/"))
			.map((d) => d.code);
		expect(openapi3).toEqual([
			"@typespec/openapi/duplicate-type-name",
			"@typespec/openapi/duplicate-type-name",
		]);
		for (const value of [{ id: "1", name: "n" }, { name: "n" }]) {
			for (const name of ["InnerX1", "InnerX2"]) {
				expect(
					contexts.schemas[`${lowerFirst(name)}Schema`]?.safeParse(value).success,
					`${name} ${JSON.stringify(value)}`,
				).toBe(contexts.byDocument(name, value));
			}
		}
	});
});

describe("a component's name", () => {
	/**
	 * openapi3 emits a named list model as an `arrayDeclaration`, which it does not reduce to `Read`,
	 * so `PairS` sent in a create body and returned is two components. Reduced here, it was one
	 * declaration under the bare name where the document publishes `PairSCreate` beside `PairS`.
	 */
	it("is the document's for a list model published at two visibilities", () => {
		expect(Object.keys(split.document.components.schemas)).toEqual(
			expect.arrayContaining(["PairS", "PairSCreate"]),
		);
		expect(split.schemas.pairSSchema).toBeDefined();
		expect(split.schemas.pairSCreateSchema).toBeDefined();
	});

	/**
	 * openapi3 suffixes a component with a visibility only where its type is used at more than one:
	 * `OuterA`, only ever sent in a create body, is `OuterA` and not `OuterACreate`.
	 */
	it("is the document's, suffixed only where the type is used at more than one visibility", () => {
		for (const loaded of [split, fixed]) {
			// Every component, the ones no operation reaches included - see `unreached/`.
			const names = Object.keys(loaded.document.components.schemas);
			expect(names).toEqual(
				expect.arrayContaining(
					loaded === split ? ["OuterA", "OuterB"] : ["CreateOuterA", "OuterB"],
				),
			);
			expect(names).not.toContain("OuterACreate");
			const missing = names.filter(
				(name) => loaded.schemas[`${lowerFirst(name)}Schema`] === undefined,
			);
			/**
			 * `Create<OuterG>` copies `Record<I3G>` as a model that is no longer a template instance,
			 * and openapi3 publishes the copy as a component named `Record`. It is declared under that
			 * name too, and the files declaring it name TypeScript's own as `globalThis.Record`.
			 */
			expect(missing).toEqual([]);
		}
		const outer = fixed.schemas.createOuterGSchema;
		const value = (r: unknown): unknown => ({
			secret: "s",
			l: [{ name: "n" }],
			u: "u",
			r,
			nu: "nu",
		});
		for (const r of [{}, { k: { name: "n" } }, { k: { id: "1", name: "n" } }, { k: 1 }]) {
			expect(outer?.safeParse(value(r)).success, JSON.stringify(r)).toBe(
				fixed.byDocument("CreateOuterG", value(r)),
			);
		}
		expect(split.schemas.outerACreateSchema).toBeUndefined();
	});
});

describe("the emitted set", () => {
	it("typechecks, the wire contract included, refused or remedied", () => {
		for (const loaded of [split, fixed]) {
			const { output, failed } = typecheckEmitted(loaded.compiled.outDir);
			expect(output).toBe("");
			expect(failed).toBe(false);
		}
	});
});
