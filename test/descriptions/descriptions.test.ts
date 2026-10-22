import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Every description the document publishes, the validator publishes at the same position.** See
 * `descriptions.tsp`.
 *
 * The arm that matters is the second. Text assertions say where `.describe()` landed; only a
 * comparison against `@typespec/openapi3`, compiled from the same program, says the text and the
 * position are the ones the contract states. That is graded through `z.toJSONSchema` with the
 * DEFAULT registry, because that is the conversion an MCP server's `tools/list` performs, and a
 * description that only a custom registry could see would reach no one.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: string;
let module: Record<string, unknown>;
let document: OpenApiDocument;

interface JsonSchema {
	readonly description?: string;
	readonly $ref?: string;
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	readonly items?: JsonSchema;
	readonly anyOf?: readonly JsonSchema[];
	readonly $defs?: Readonly<Record<string, JsonSchema>>;
}

interface OpenApiDocument {
	readonly components: { readonly schemas: Readonly<Record<string, JsonSchema>> };
	readonly paths: Readonly<
		Record<
			string,
			Readonly<
				Record<
					string,
					{
						readonly operationId: string;
						readonly parameters?: readonly {
							readonly name: string;
							readonly in: string;
							readonly description?: string;
						}[];
					}
				>
			>
		>
	>;
}

const SLUG_DOC = "A slug: lower-case words joined by dots or dashes, such as `science-fiction`.";
const TRICKY_DOC =
	'A doc with "quotes", a back\\slash, a */ terminator,\nand a second line naming uriExpansion, explodedQuery, .pipe( and z.preprocess( as text.';

beforeAll(async () => {
	compiled = await compileFixture(here, "descriptions", { outName: "descriptions" });
	schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
	module = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
	const [record] = await getOpenAPI3(compiled.program, { "openapi-versions": ["3.1.0"] });
	document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as OpenApiDocument;
}, 300_000);

/** The emitted expression for one property of `reviewSchema`. */
function propertyOf(name: string): string {
	const declaration = /export const reviewSchema = [\s\S]*?\n\}\)/.exec(schemas)?.[0] ?? "";
	return (
		new RegExp(`\\n\\t${name}: ([^\\n]+),`).exec(declaration)?.[1] ??
		new RegExp(`\\n\\tget ${name}\\(\\)[^\\n]*\\{\\n\\t\\treturn ([^\\n]+);`).exec(
			declaration,
		)?.[1] ??
		""
	);
}

function exported(name: string): z.ZodType {
	const value = module[name];
	if (!(value instanceof z.ZodType)) throw new Error(`no schema exported as ${name}`);
	return value;
}

/** `#/components/schemas/X` or `#/$defs/X` or `#`, resolved against the document it came from. */
function dereference(schema: JsonSchema, root: JsonSchema, components: Record<string, JsonSchema>) {
	const ref = schema.$ref;
	if (ref === undefined) return undefined;
	if (ref === "#") return root;
	const name = ref.split("/").at(-1) ?? "";
	return ref.startsWith("#/components/schemas/") ? components[name] : root.$defs?.[name];
}

/**
 * The description a reader sees at a position: the position's own, else the one on what it refers
 * to. A sibling `description` beside a `$ref` wins, which is OpenAPI 3.1's rule and Zod's flattening.
 */
function effective(
	schema: JsonSchema | undefined,
	root: JsonSchema,
	components: Record<string, JsonSchema> = {},
): string | undefined {
	if (schema === undefined) return undefined;
	if (schema.description !== undefined) return schema.description;
	const target = dereference(schema, root, components);
	return target === undefined || target === schema
		? undefined
		: effective(target, root, components);
}

describe("where the emitted validators carry a description", () => {
	it("compiles the fixture without an error or a warning", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	it("emits the property expressions this suite reads", () => {
		for (const name of ["genre", "plain", "nullableUndocumented", "tricky", "parent"]) {
			expect(propertyOf(name), `no expression found for ${name}`).not.toBe("");
		}
	});

	it("describes a documented property, outermost", () => {
		expect(propertyOf("genre")).toMatch(
			/^z\.string\(\)\.regex\(.*\)\.describe\("The genre the review files under\."\)$/,
		);
		expect(propertyOf("headline")).toBe('z.string().describe("The headline of the review.")');
	});

	it("describes an undocumented property by the declared scalar it names", () => {
		expect(propertyOf("inheritsScalarDoc")).toMatch(
			new RegExp(`\\.describe\\(${escape(JSON.stringify(SLUG_DOC))}\\)$`),
		);
	});

	it("describes an undocumented scalar by the nearest doc up its extends chain", () => {
		expect(propertyOf("inheritedChain")).toMatch(
			new RegExp(`\\.describe\\(${escape(JSON.stringify(SLUG_DOC))}\\)$`),
		);
	});

	it("describes a documented property ONCE, by its own doc, over its scalar's", () => {
		const section = propertyOf("section");
		expect(section.match(/\.describe\(/g)).toHaveLength(1);
		expect(section).toMatch(
			/\.describe\("The property's own doc, which wins over the scalar's\."\)$/,
		);
	});

	it("leaves an undocumented property of a built-in type undescribed", () => {
		expect(propertyOf("plain")).toBe("z.string()");
		// The compiler's own doc on `string`, which openapi3 deletes on purpose.
		expect(schemas).not.toContain("A sequence of textual characters");
	});

	it("puts a scalar's description inside .nullable(), and the property's outside it", () => {
		expect(propertyOf("nullableUndocumented")).toMatch(/\.describe\(".*"\)\.nullable\(\)$/);
		expect(propertyOf("nullableDocumented")).toMatch(
			/\.nullable\(\)\.describe\("A genre that may be explicitly null\."\)$/,
		);
	});

	it("describes outside .exactOptional() and .default(), so the wrapper keeps its meaning", () => {
		expect(propertyOf("note")).toBe(
			'z.string().exactOptional().describe("A note, which may be left out.")',
		);
		expect(propertyOf("reads")).toBe(
			'z.int32().default(1).describe("How many times it was read, one if not said.")',
		);
	});

	it("writes the doc as a string literal, whatever it contains", () => {
		expect(propertyOf("tricky")).toBe(
			`z.string().exactOptional().describe(${JSON.stringify(TRICKY_DOC)})`,
		);
	});

	it("describes a declaration once, on its own body", () => {
		expect(schemas).toMatch(
			/export const formatSchema = z\.enum\(.*\)\.describe\("The binding a book is printed in\."\);/,
		);
		expect(schemas).toMatch(/\n\}\)\.describe\("A review of a book, by one reader\."\);/);
	});

	it("describes a visibility projection by the model it projects", () => {
		// The write's own projection, which openapi3 publishes as `BookCreateOrUpdate`.
		const projected = z.toJSONSchema(exported("bookCreateOrUpdateSchema"), { io: "input" });
		expect(projected.description).toBe("A book on the shelf, with its reviews.");
		expect((projected as JsonSchema).properties?.["authors"]?.description).toBe(
			"The names on the cover.",
		);
		expect((projected as JsonSchema).properties?.["blurb"]?.description).toBe(
			"The cover text, which only a write carries.",
		);
	});
});

describe("the descriptions agree with the document", () => {
	const graded: string[] = [];

	it("publishes, for every component and property, the description the document publishes", () => {
		const components = document.components.schemas;
		for (const [name, published] of Object.entries(components)) {
			const value = module[`${name.charAt(0).toLowerCase()}${name.slice(1)}Schema`];
			if (!(value instanceof z.ZodType)) continue;
			const emitted = z.toJSONSchema(value, { io: "input" }) as JsonSchema;
			expect(emitted.description, name).toBe(published.description);
			graded.push(name);
			for (const [key, property] of Object.entries(published.properties ?? {})) {
				const mine = emitted.properties?.[key];
				expect(effective(mine, emitted), `${name}.${key}`).toBe(
					effective(property, published, components),
				);
				expect(effective(mine?.items, emitted), `${name}.${key}[]`).toBe(
					effective(property.items, published, components),
				);
				const branches = property.anyOf ?? [];
				for (const [index, branch] of branches.entries()) {
					expect(effective(mine?.anyOf?.[index], emitted), `${name}.${key}|${index}`).toBe(
						effective(branch, published, components),
					);
				}
				graded.push(`${name}.${key}`);
			}
		}
		// Non-vacuity: Review's properties, Book's, and the enum and union declarations.
		expect(graded).toEqual(
			expect.arrayContaining(["Review", "Book", "Format", "Edition", "Review.tricky"]),
		);
		expect(graded).toHaveLength(24);
	});

	it("publishes each parameter's description where the document's Parameter object carries it", () => {
		const seen: string[] = [];
		for (const methods of Object.values(document.paths)) {
			for (const operation of Object.values(methods)) {
				for (const parameter of operation.parameters ?? []) {
					const group = { path: "Path", query: "Query", header: "Header" }[parameter.in];
					const emitted = z.toJSONSchema(exported(`${operation.operationId}${group}`), {
						io: "input",
					}) as JsonSchema;
					expect(emitted.properties?.[parameter.name]?.description, parameter.name).toBe(
						parameter.description,
					);
					seen.push(`${operation.operationId}.${parameter.name}`);
				}
			}
		}
		// `read.genre` is the `@param` tag: the compiler makes it the parameter's own doc.
		expect(seen.toSorted()).toEqual([
			"read.genre",
			"shelveBook.filter",
			"shelveBook.id",
			"shelveBook.x-caller",
		]);
	});
});

describe("a description changes nothing a validator decides", () => {
	it("accepts and refuses exactly as the declared types say", () => {
		const review = {
			genre: "science-fiction",
			inheritsScalarDoc: "a",
			section: "b",
			inheritedChain: "c",
			headline: "a fine read",
			plain: "x",
			nullableDocumented: null,
			nullableUndocumented: "d",
		};
		const book = exported("bookSchema");
		const valid = { reviews: [review], authors: [] };
		expect(book.safeParse(valid).success).toBe(true);
		expect(
			book.safeParse({ ...valid, reviews: [{ ...review, genre: "Not A Slug" }] }).success,
		).toBe(false);
		expect(
			book.safeParse({
				...valid,
				reviews: [{ ...review, parent: { ...review, plain: 1 } }],
			}).success,
		).toBe(false);
	});

	it("is readable from the schema a consumer holds", () => {
		const shape = (exported("reviewSchema") as unknown as { shape: Record<string, z.ZodType> })
			.shape;
		expect(shape["genre"]?.description).toBe("The genre the review files under.");
		expect(shape["plain"]?.description).toBeUndefined();
	});
});

describe("spec text inside a string literal is not code", () => {
	it("declares no helper that only a description names", () => {
		// The `x-caller` parameter's doc names both RFC 6570 decoders, and the route declarations are
		// what decides which of them to declare. This service decodes nothing.
		expect(schemas).not.toMatch(/function uriExpansion|const uriExpansion/);
		expect(schemas).not.toMatch(/function explodedQuery|const explodedQuery/);
	});

	it("typechecks under a consumer's settings, noUnusedLocals included", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(failed, output).toBe(false);
	});

	it("typechecks with compile-schemas on, where every declaration is wrapped", async () => {
		const wrapped = await compileFixture(here, "descriptions", {
			outName: "descriptions-compiled",
			extraOptions: { "compile-schemas": true },
		});
		const emitted = readFileSync(join(wrapped.outDir, "schemas.gen.ts"), "utf8");
		expect(emitted).toContain("z.compile(");
		const { output, failed } = typecheckEmitted(wrapped.outDir);
		expect(failed, output).toBe(false);
		const review = (await import(join(wrapped.outDir, "schemas.gen.ts"))) as Record<
			string,
			unknown
		>;
		const json = z.toJSONSchema(review["reviewSchema"] as z.ZodType, {
			io: "input",
		}) as JsonSchema;
		expect(json.description).toBe("A review of a book, by one reader.");
		expect(json.properties?.["genre"]?.description).toBe("The genre the review files under.");
	});
});

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
