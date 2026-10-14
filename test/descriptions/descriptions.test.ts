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

const SUBJECT_DOC =
	"A subject key: lower-case words joined by dots or dashes, such as `billing.invoice`.";
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

/** The emitted expression for one property of `premiseSchema`. */
function propertyOf(name: string): string {
	const declaration = /export const premiseSchema = [\s\S]*?\n\}\)/.exec(schemas)?.[0] ?? "";
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
		for (const name of ["subject", "plain", "nullableUndocumented", "tricky", "parent"]) {
			expect(propertyOf(name), `no expression found for ${name}`).not.toBe("");
		}
	});

	it("describes a documented property, outermost", () => {
		expect(propertyOf("subject")).toMatch(
			/^z\.string\(\)\.regex\(.*\)\.describe\("What the premise is about\."\)$/,
		);
		expect(propertyOf("predicate")).toBe('z.string().describe("What is claimed of the subject.")');
	});

	it("describes an undocumented property by the declared scalar it names", () => {
		expect(propertyOf("inheritsScalarDoc")).toMatch(
			new RegExp(`\\.describe\\(${escape(JSON.stringify(SUBJECT_DOC))}\\)$`),
		);
	});

	it("describes an undocumented scalar by the nearest doc up its extends chain", () => {
		expect(propertyOf("inheritedChain")).toMatch(
			new RegExp(`\\.describe\\(${escape(JSON.stringify(SUBJECT_DOC))}\\)$`),
		);
	});

	it("describes a documented property ONCE, by its own doc, over its scalar's", () => {
		const area = propertyOf("area");
		expect(area.match(/\.describe\(/g)).toHaveLength(1);
		expect(area).toMatch(/\.describe\("The property's own doc, which wins over the scalar's\."\)$/);
	});

	it("leaves an undocumented property of a built-in type undescribed", () => {
		expect(propertyOf("plain")).toBe("z.string()");
		// The compiler's own doc on `string`, which openapi3 deletes on purpose.
		expect(schemas).not.toContain("A sequence of textual characters");
	});

	it("puts a scalar's description inside .nullable(), and the property's outside it", () => {
		expect(propertyOf("nullableUndocumented")).toMatch(/\.describe\(".*"\)\.nullable\(\)$/);
		expect(propertyOf("nullableDocumented")).toMatch(
			/\.nullable\(\)\.describe\("A subject that may be explicitly null\."\)$/,
		);
	});

	it("describes outside .exactOptional() and .default(), so the wrapper keeps its meaning", () => {
		expect(propertyOf("note")).toBe(
			'z.string().exactOptional().describe("A note, which may be left out.")',
		);
		expect(propertyOf("checks")).toBe(
			'z.int32().default(1).describe("How many times it was checked, one if not said.")',
		);
	});

	it("writes the doc as a string literal, whatever it contains", () => {
		expect(propertyOf("tricky")).toBe(
			`z.string().exactOptional().describe(${JSON.stringify(TRICKY_DOC)})`,
		);
	});

	it("describes a declaration once, on its own body", () => {
		expect(schemas).toMatch(
			/export const confidenceSchema = z\.enum\(.*\)\.describe\("How sure the agent is of a premise\."\);/,
		);
		expect(schemas).toMatch(
			/\n\}\)\.describe\("A premise an agent relies on when it declares a change\."\);/,
		);
	});

	it("describes a visibility projection by the model it projects", () => {
		// openapi3 3.1 publishes no separate component for it, so the parity arm cannot reach it.
		const projected = z.toJSONSchema(exported("declarationCreateOrUpdateSchema"), { io: "input" });
		expect(projected.description).toBe("A declaration of intent, with the premises it rests on.");
		expect((projected as JsonSchema).properties?.["footprint"]?.description).toBe(
			"The files the change will touch.",
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
		// Non-vacuity: Premise's properties, Declaration's, and the enum and union declarations.
		expect(graded).toEqual(
			expect.arrayContaining(["Premise", "Declaration", "Confidence", "Phase", "Premise.tricky"]),
		);
		expect(graded).toHaveLength(21);
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
		// `read.subject` is the `@param` tag: the compiler makes it the parameter's own doc.
		expect(seen.toSorted()).toEqual([
			"declareChange.filter",
			"declareChange.id",
			"declareChange.x-caller",
			"read.subject",
		]);
	});
});

describe("a description changes nothing a validator decides", () => {
	it("accepts and refuses exactly as the declared types say", () => {
		const premise = {
			subject: "billing.invoice",
			inheritsScalarDoc: "a",
			area: "b",
			inheritedChain: "c",
			predicate: "is paid",
			plain: "x",
			nullableDocumented: null,
			nullableUndocumented: "d",
		};
		const declaration = exported("declarationSchema");
		const valid = { premises: [premise], footprint: [], recordedAt: "2026-10-14T12:00:00Z" };
		expect(declaration.safeParse(valid).success).toBe(true);
		expect(
			declaration.safeParse({ ...valid, premises: [{ ...premise, subject: "Not A Key" }] }).success,
		).toBe(false);
		expect(
			declaration.safeParse({
				...valid,
				premises: [{ ...premise, parent: { ...premise, plain: 1 } }],
			}).success,
		).toBe(false);
	});

	it("is readable from the schema a consumer holds", () => {
		const shape = (exported("premiseSchema") as unknown as { shape: Record<string, z.ZodType> })
			.shape;
		expect(shape["subject"]?.description).toBe("What the premise is about.");
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
		const premise = (await import(join(wrapped.outDir, "schemas.gen.ts"))) as Record<
			string,
			unknown
		>;
		const json = z.toJSONSchema(premise["premiseSchema"] as z.ZodType, {
			io: "input",
		}) as JsonSchema;
		expect(json.description).toBe("A premise an agent relies on when it declares a change.");
		expect(json.properties?.["subject"]?.description).toBe("What the premise is about.");
	});
});

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
