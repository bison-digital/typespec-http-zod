import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSourceLocation } from "@typespec/compiler";
import { getAllHttpServices } from "@typespec/http";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { collectRoutes } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A redeclared property validates as the `allOf` the document holds it to.** See `merge.tsp`.
 *
 * openapi3 publishes every model in a chain with its own declaration of a key, joined by `allOf`, so
 * a value is held to each. This emitter refused every override whose type did not narrow the one
 * above it - `Page<Widget>` over `Page<Item>`, `{tag: "a"}` over `{tag: string}`, `Open` over
 * `Record<unknown>` - and among the ones it took, applied a list's element rules to a union element
 * so the module threw on import, kept a `null` the base refuses, dropped a named list's `@minItems`,
 * and applied a create-only or `@header` declaration above a response that publishes neither.
 *
 * **Every verdict is graded by Ajv against the document, sealed and open**, and the emitted set is
 * compiled, so the contract types agree with the validators keyword for keyword.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

interface Built {
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
	readonly byDocument: (schema: unknown, value: unknown) => boolean;
	readonly document: {
		readonly components: { readonly schemas: Record<string, unknown> };
		readonly paths: Record<string, Record<string, unknown>>;
	};
}

async function build(name: string, sealed: boolean): Promise<Built> {
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
	) as Built["document"];
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	return {
		compiled,
		schemas,
		document,
		byDocument: (schema, value) =>
			ajv.validate({ ...(schema as object), components: document.components }, value),
	};
}

const identifierOf = (component: string): string =>
	`${component.charAt(0).toLowerCase()}${component.slice(1)}Schema`;

const NULLS = { at: "ab", v: "a", w: "b", xs: ["a"], meta: { tag: "t" } };

/** Each component, and values on both sides of what the document accepts. */
const CASES: readonly (readonly [string, readonly unknown[]])[] = [
	[
		"NullSub",
		[
			NULLS,
			{ ...NULLS, at: null },
			{ ...NULLS, v: null },
			{ ...NULLS, w: null },
			{ ...NULLS, d: null },
			{ ...NULLS, xs: null },
			{ ...NULLS, meta: null },
			{ ...NULLS, at: "abcd" },
			{ ...NULLS, v: "b" },
		],
	],
	[
		"PetSub",
		[
			{ pet: { meow: true } },
			{ pet: { meow: true, kind: "cat", value: { meow: true } } },
			{ pet: { meow: true, kind: "dog", value: { bark: true } } },
			{ pet: { kind: "cat", value: { meow: true } } },
		],
	],
	[
		"TagsSub",
		[
			{ tags: ["ab", "x"], maybe: ["a", null] },
			{ tags: [""], maybe: [] },
			{ tags: ["abcd"], maybe: [] },
			{ tags: ["y"], maybe: [""] },
		],
	],
	[
		"TagsRenamed",
		[
			{ tags: ["ab"], maybe: [] },
			{ tags: [null], maybe: [] },
			{ tags: [""], maybe: [] },
		],
	],
	[
		"TagsLoose",
		[
			{ tags: ["ab", "x"], maybe: [] },
			{ tags: ["abcd"], maybe: [] },
		],
	],
	["MixedSub", [{ tags: ["ab", "x"] }, { tags: ["abcd"] }, { tags: [5] }]],
	["ListSub", [{ tags: ["a", "b"] }, { tags: ["a"] }, { tags: ["abcd", "a"] }]],
	["CodeSub", [{ c: "ab" }, { c: "CD" }, { c: "zz" }]],
	["HueSub", [{ c: "red" }, { c: "green" }, { c: "blue" }]],
	[
		"TreeSub",
		[
			{ name: "a", tags: ["b"], kids: [{ name: "c", tags: ["d"] }] },
			{ name: "a", tags: [""] },
			{ name: "a", tags: ["b"], kids: [{ name: "c", tags: [""] }] },
		],
	],
	[
		"PageSub",
		[
			{ page: { items: [{ id: "1" }] } },
			{ page: { items: [{ id: "1", color: "r" }], next: "n" } },
			{ page: { items: [{}] } },
			{ page: { items: [{ id: "1", extra: 1 }] } },
		],
	],
	["InlineSub", [{ meta: { tag: "a" } }, { meta: { tag: "b" } }]],
	["LabelSub", [{ meta: { tag: "a" } }, { meta: { tag: "a", extra: "e" } }, { meta: {} }]],
	["AttrsSub", [{ attrs: { tag: "t" } }, { attrs: { tag: "t", z: 1 } }, { attrs: {} }]],
	["PropsSub", [{ p: { x: 1 } }, { p: { x: "1" } }, { p: {} }]],
	["UnrelatedSub", [{ meta: { tag: "ab" } }, { meta: { tag: "abc" } }]],
	["FloatSub", [{ f: 1 }, { f: 1.5 }, { f: "1" }]],
	["InstantSub", [{ at: "2020-01-01T00:00:00Z" }, { at: 5 }]],
	["WidthSub", [{ n: 5 }, { n: "5" }, { n: 1.5 }]],
	["PaintSub", [{ c: "red" }, { c: "green" }, { c: "blue" }]],
	["Odd", [{ name: "n", kind: "x" }, { name: "n", kind: null }, { name: "n" }]],
	[
		"Serpent",
		[
			{ kind: "asp", length: 1 },
			{ kind: "cobra", length: 1, hood: 1 },
		],
	],
	["SecretSub", [{ secret: "abc" }, {}]],
	[
		"PasswordSub",
		[{ name: "n", password: "abc" }, { name: "n" }, { name: "n", password: "abcdef" }],
	],
	["HeaderSub", [{ name: "abc", id: "i" }, { id: "i" }]],
	["GoneSub", [{ x: "a", y: 1 }, { y: 1 }, { x: "abcd", y: 1 }]],
];

for (const sealed of [true, false]) {
	describe(`a redeclared property, ${sealed ? "sealed" : "open"}`, () => {
		let built: Built;
		beforeAll(async () => {
			built = await build("merge", sealed);
		}, 300_000);

		it("refuses nothing but the subtype no dispatch can hold, and the default no value is", () => {
			expect(built.compiled.diagnostics.map((d) => d.code).toSorted()).toEqual([
				"typespec-http-zod/invalid-default",
				"typespec-http-zod/invalid-subtype-discriminator",
			]);
		});

		for (const [component, values] of CASES) {
			it(`${component}: answers every value as the document does`, () => {
				const validator = built.schemas[identifierOf(component)];
				expect(validator, identifierOf(component)).toBeDefined();
				for (const value of values) {
					const parsed = (validator as ZodType).safeParse(value);
					const verdict = built.byDocument({ $ref: `#/components/schemas/${component}` }, value);
					expect(parsed.success, `${component} ${JSON.stringify(value)}`).toBe(verdict);
					// Sealed, every value accepted holds only declared keys, and comes back as it was sent.
					if (sealed && parsed.success) expect(parsed.data).toEqual(value);
				}
			});
		}

		it("grades values the document refuses as well as ones it accepts, for every component", () => {
			for (const [component, values] of CASES) {
				const verdicts = values.map((value) =>
					built.byDocument({ $ref: `#/components/schemas/${component}` }, value),
				);
				if (component !== "PropsSub" && !(sealed && component === "PetSub")) {
					expect(verdicts, component).toContain(true);
				}
				expect(verdicts, component).toContain(false);
			}
		});

		it("checks a scalar alone where its check says everything the other's does", () => {
			const emitted = readFileSync(join(built.compiled.outDir, "schemas.gen.ts"), "utf8");
			const declaration = (name: string): string =>
				/^export const \w+ = [^]*?\n\}\);$/m.exec(
					emitted.slice(emitted.indexOf(`export const ${name} =`)),
				)?.[0] ?? "";
			expect(declaration("floatSubSchema")).toContain("\n\tf: z.int32(),\n");
			expect(declaration("instantSubSchema")).toContain(
				"\n\tat: z.iso.datetime({ offset: true }),\n",
			);
		});

		it("checks both widths where neither scalar narrows the other", () => {
			const width = built.schemas["widthSubSchema"] as ZodType;
			expect(width.safeParse({ n: 127 }).success).toBe(true);
			expect(width.safeParse({ n: 200 }).success).toBe(false);
			expect(width.safeParse({ n: -5 }).success).toBe(false);
		});

		it("emits a set that compiles, the validator and contract types identical", () => {
			const { output, failed } = typecheckEmitted(built.compiled.outDir);
			expect(output).toBe("");
			expect(failed).toBe(false);
		});
	});
}

/**
 * **A request body and a response are validated as the document publishes each, under its name.**
 * See `visibility.tsp`.
 *
 * The emitter read visibility with `@typespec/http`'s default canonical `All` where openapi3 reads
 * `Read`: a model whose create-only property is visible at `All` was not transformed at `Create`, so
 * its create body was declared under the bare name and every RESPONSE was validated as the create
 * view - `{name}` refused for want of a `secret` no response carries. And a read-only property is
 * one openapi3 shares into the request, as `readOnly`, under OAS 3.1's reading: still required.
 */
describe("a request body and a response, at their own visibility", () => {
	let built: Built;
	let routes: ReturnType<typeof collectRoutes>;
	beforeAll(async () => {
		built = await build("visibility", true);
		const [services] = getAllHttpServices(built.compiled.program);
		const service = services[0];
		if (service === undefined) throw new Error("fixture declares no service");
		routes = collectRoutes(
			built.compiled.program,
			new SchemaRegistry(built.compiled.program),
			service,
		);
	}, 300_000);

	const operations: readonly (readonly [
		id: string,
		path: string,
		verb: string,
		request: readonly unknown[],
		response: readonly unknown[],
	])[] = [
		[
			"createGadget",
			"/gadgets",
			"post",
			[{ secret: "s", name: "n" }, { name: "n" }],
			[{ name: "n" }, { name: "n", secret: "s" }],
		],
		["readGadget", "/gadgets", "get", [], [{ name: "n" }, { name: "n", secret: "s" }]],
		[
			"createEntry",
			"/entries",
			"post",
			[{ id: "i", name: "n" }, { name: "n" }],
			[{ id: "i", name: "n" }, { name: "n" }],
		],
	];

	it("compiles without a diagnostic", () => {
		expect(built.compiled.diagnostics).toEqual([]);
	});

	for (const [id, path, verb, request, response] of operations) {
		it(`${id}: names and validates each body as the document does`, () => {
			const route = routes.find((candidate) => candidate.operationId === id);
			const operation = built.document.paths[path]?.[verb] as {
				requestBody?: { content: Record<string, { schema: { $ref: string } }> };
				responses: Record<string, { content?: Record<string, { schema: { $ref: string } }> }>;
			};
			const pairs: (readonly [
				ref: string,
				identifier: string | undefined,
				values: readonly unknown[],
			])[] = [];
			const requested = operation.requestBody?.content["application/json"]?.schema.$ref;
			if (requested !== undefined) pairs.push([requested, route?.requestSchema, request]);
			const answered = operation.responses["200"]?.content?.["application/json"]?.schema.$ref;
			const served = route?.responses.find((each) => each.status === 200)?.schema;
			if (answered !== undefined) pairs.push([answered, served, response]);
			expect(pairs.length).toBeGreaterThan(0);
			for (const [ref, identifier, values] of pairs) {
				// The component the document names is the declaration the route validates with.
				expect(identifier).toBe(identifierOf(ref.split("/").at(-1) as string));
				for (const value of values) {
					expect(
						(built.schemas[identifier as string] as ZodType).safeParse(value).success,
						`${id} ${ref} ${JSON.stringify(value)}`,
					).toBe(built.byDocument({ $ref: ref }, value));
				}
			}
		});
	}

	it("emits a set that compiles", () => {
		const { output, failed } = typecheckEmitted(built.compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});

/**
 * **A type inside an explicit `@body` is declared apart from the same type outside one**, because
 * inside, `@typespec/http` ignores its metadata annotations and the document holds a `@header` as
 * data. One model in both positions is two shapes under one name, which openapi3 refuses as
 * `duplicate-type-name`; keyed alike, the first position silently gave the other its shape.
 */
describe("one model inside an explicit body and outside one", () => {
	it("is refused by both walks, once, as openapi3 refuses it", async () => {
		const compiled = await compileFixture(here, "bodycontext", { outName: "bodycontext" });
		// `@typespec/http` warns `metadata-ignored` of the header inside the body, as it should.
		expect(
			compiled.diagnostics
				.map((d) => d.code)
				.filter((code) => code.startsWith("typespec-http-zod/")),
		).toEqual(["typespec-http-zod/duplicate-declaration"]);
		// Both walks refuse it: the module declares `Tagged` once, and the set typechecks.
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
		const messages = compiled.program.diagnostics
			.filter((d) => d.code === "typespec-http-zod/duplicate-declaration")
			.map((d) => d.message);
		for (const message of messages) {
			expect(message).toContain("'Tagged' is published inside an explicit '@body'");
		}
		// At the model itself: the copy a payload is rendered from has no source of its own.
		for (const diagnostic of compiled.program.diagnostics.filter(
			(d) => d.code === "typespec-http-zod/duplicate-declaration",
		)) {
			expect(getSourceLocation(diagnostic.target as never).file.path).toMatch(/bodycontext\.tsp$/);
		}
		await getOpenAPI3(compiled.program, { "openapi-versions": ["3.1.0"] });
		expect(compiled.program.diagnostics.map((d) => d.code)).toContain(
			"@typespec/openapi/duplicate-type-name",
		);
	}, 300_000);
});

/**
 * **A chain of declarations, judged as the document publishes each link.** See `chains.tsp`. Into a
 * union of declared scalars the override was held to the first member it narrowed, and to another's
 * pattern beside it; a list literal's elements were read without `Item` visibility, so PATCH made
 * them optional and a `@header` on one dropped out; a base was judged at its subtype's visibility; the
 * nearest indexer stood in for the topmost; a named list's `@minItems` was dropped where an override
 * narrowed it; a `null` an element or a value took survived the declaration above refusing it; a union
 * a request reshapes was one declaration for request and response; an envelope on a cycle read its
 * variant before it was declared; and `@oneOf` accepted a value two members accept.
 */
for (const sealed of [true, false]) {
	describe(`a chain of declarations, ${sealed ? "sealed" : "open"}`, () => {
		let built: Built;
		let routes: ReturnType<typeof collectRoutes>;
		beforeAll(async () => {
			built = await build("chains", sealed);
			const [services] = getAllHttpServices(built.compiled.program);
			const service = services[0];
			if (service === undefined) throw new Error("fixture declares no service");
			routes = collectRoutes(
				built.compiled.program,
				new SchemaRegistry(built.compiled.program),
				service,
			);
		}, 300_000);

		const operations: readonly (readonly [
			id: string,
			path: string,
			verb: string,
			request: readonly unknown[],
			response: readonly unknown[],
		])[] = [
			["u", "/u", "post", [{ v: "123" }, { v: "12345" }, { v: "abc" }], []],
			["nn", "/nn", "post", [{ n: 250 }, { n: 150 }, { n: 5 }], []],
			[
				"e",
				"/e",
				"post",
				[
					{ z: "z", items: [{ code: "abc", name: "n" }] },
					{ z: "z", items: [{ name: "n" }] },
					{ z: "z", items: [{ code: "abcd", name: "n" }] },
				],
				[],
			],
			["f", "/f", "get", [], [[{ code: "ab", name: "n" }], [{ name: "n" }]]],
			[
				"patchWrap",
				"/w",
				"patch",
				[{ els: [{ u: "u", name: "n" }] }, { els: [{}] }, { els: [{ name: "n" }] }, {}],
				[],
			],
			[
				"createDerived",
				"/d",
				"post",
				[
					{ secret: "s", name: "n", id: "abc" },
					{ secret: "s", name: "n" },
					{ secret: "s", name: "n", id: "abcd" },
				],
				[{ name: "n", id: "abc" }, { name: "n" }],
			],
			["s5", "/s5", "post", [{ m: { x: "a" } }, { m: { x: "a", y: 1 } }, { m: {} }], []],
			["ss", "/ss", "post", [{ k: "abcd" }, { k: 5 }], []],
			[
				"l",
				"/l",
				"post",
				[{ b: ["ab", "cd"] }, { b: ["ab"] }, { b: ["a", "b", "c"] }, { b: ["AB", "cd"] }],
				[],
			],
			[
				"b9",
				"/b9",
				"post",
				[
					{ xs: ["a"], r: { k: "v" } },
					{ xs: [null], r: {} },
					{ xs: [], r: { k: null } },
				],
				[],
			],
			[
				"createN",
				"/n",
				"post",
				[{ n: { name: "x", secret: "s" } }, { n: { name: "x" } }, { n: "t" }],
				[{ n: { name: "x" } }, { n: { name: "x", secret: "s" } }],
			],
			[
				"cat",
				"/cat",
				"post",
				[
					{ meow: true },
					{ meow: true, owner: { pet: { kind: "dog", value: { bark: true } } } },
					{ meow: "x" },
				],
				[],
			],
			[
				"oh",
				"/oh",
				"post",
				[{ u: { a: "x" } }, { u: { a: "x", b: 5 } }, { u: { a: 5, b: "y" } }],
				[],
			],
		];

		for (const [id, path, verb, request, response] of operations) {
			it(`${id}: validates each body as the document does`, () => {
				const route = routes.find((candidate) => candidate.operationId === id);
				const operation = built.document.paths[path]?.[verb] as {
					requestBody?: { content: Record<string, { schema: unknown }> };
					responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
				};
				const pairs: (readonly [
					schema: unknown,
					identifier: string | undefined,
					values: readonly unknown[],
				])[] = [];
				const requested = operation.requestBody?.content["application/json"]?.schema;
				if (request.length > 0) pairs.push([requested, route?.requestSchema, request]);
				const answered = operation.responses["200"]?.content?.["application/json"]?.schema;
				// A response body spelled as an expression is exported under the arm's own name.
				const served = route?.responses.find((each) => each.status === 200)?.schema;
				const arm = served !== undefined && served in built.schemas ? served : `${id}Response200`;
				if (response.length > 0) pairs.push([answered, arm, response]);
				const verdicts: boolean[] = [];
				for (const [schema, identifier, values] of pairs) {
					const validator = built.schemas[identifier as string] as ZodType | undefined;
					expect(validator, `${id} ${identifier}`).toBeDefined();
					for (const value of values) {
						const verdict = built.byDocument(schema, value);
						verdicts.push(verdict);
						expect(
							(validator as ZodType).safeParse(value).success,
							`${id} ${JSON.stringify(value)}`,
						).toBe(verdict);
					}
				}
				expect(verdicts).toContain(true);
				if (!(id === "s5" && !sealed)) expect(verdicts).toContain(false);
			});
		}

		it("reports the defaults the declarations above rule out, and nothing else of its own", () => {
			// The compile's own, before this suite's `collectRoutes` - another module instance - ran.
			const own = built.compiled.diagnostics.filter((d) => d.code.startsWith("typespec-http-zod/"));
			expect(own.map((d) => d.code).toSorted()).toEqual([
				"typespec-http-zod/default-on-required-property",
				"typespec-http-zod/invalid-default",
				"typespec-http-zod/invalid-default",
			]);
			// Required by the declaration above, which is no discriminator.
			expect(
				built.compiled.program.diagnostics.find((d) =>
					d.code.endsWith("default-on-required-property"),
				)?.message,
			).toContain("is required by a declaration of its key above it");
			expect(built.schemas["anc2Schema"]?.parse({})).toEqual({});
		});

		it("emits a set that compiles", () => {
			const { output, failed } = typecheckEmitted(built.compiled.outDir);
			expect(output).toBe("");
			expect(failed).toBe(false);
		});
	});
}
