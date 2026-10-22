import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A type no operation reaches is declared, as openapi3 publishes it.** See `unreached.tsp`.
 *
 * openapi3 publishes every model, enum and union of the service as a component, reached or not, at
 * `All` - `processUnreferencedSchemas`, with `omitUnreachableTypes` unset. This emitter declared only
 * what an operation reached, so a model a service declares for its consumers - an event payload, a
 * webhook body - had a component in the document and no validator or contract type here.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let components: Record<string, unknown>;
let byDocument: (component: string, value: unknown) => boolean;

beforeAll(async () => {
	compiled = await compileFixture(here, "unreached", { outName: "unreached" });
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		"seal-object-schemas": true,
	});
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as { components: { schemas: Record<string, unknown> } };
	components = document.components.schemas;
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	byDocument = (component, value) =>
		ajv.validate(
			{ $ref: `#/components/schemas/${component}`, components: document.components },
			value,
		);
}, 300_000);

/** The identifier a component is declared under: its own name, the namespace dropped. */
const identifierOf = (component: string): string => {
	const name = component.slice(component.lastIndexOf(".") + 1);
	return `${name.charAt(0).toLowerCase()}${name.slice(1)}Schema`;
};

describe("a type no operation reaches", () => {
	it("compiles with no error", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("is declared for every component the document publishes", () => {
		const names = Object.keys(components);
		expect(names).toEqual(
			expect.arrayContaining([
				"Plain",
				"Holder",
				"Staged",
				"Colour",
				"Shape",
				"Circle",
				"Animal",
				"Dog",
				"Tags",
				"Sub.SubThing",
			]),
		);
		expect(names.filter((name) => schemas[identifierOf(name)] === undefined)).toEqual([]);
	});

	it("is not declared where openapi3 publishes no schema for it", () => {
		expect(Object.keys(components)).not.toContain("Params");
		expect(schemas.paramsSchema).toBeUndefined();
		expect(Object.keys(components).filter((name) => name.startsWith("Box"))).toEqual([]);
		expect(Object.keys(schemas).filter((name) => name.startsWith("box"))).toEqual([]);
	});

	it("validates as the document does, at `All`", () => {
		const values: unknown[] = [
			{},
			{ name: "n" },
			{ name: "n", count: 1 },
			{ name: "n", count: "1" },
			{ reached: { id: "1", name: "n" }, plain: { name: "n" }, tags: ["a"] },
			{ reached: { name: "n" }, plain: { name: "n" }, tags: ["a"] },
			{ secret: "s", id: "1", name: "n" },
			{ id: "1", name: "n" },
			"red",
			"blue",
			"text",
			{ radius: 1 },
			{ kind: "dog", bark: true },
			{ kind: "cat" },
			["a"],
			[1],
			{ x: "x" },
		];
		for (const name of Object.keys(components)) {
			const schema = schemas[identifierOf(name)];
			for (const value of values) {
				expect(schema?.safeParse(value).success, `${name} ${JSON.stringify(value)}`).toBe(
					byDocument(name, value),
				);
			}
		}
	});

	it("typechecks with the rest of the emitted set", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
