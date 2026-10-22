import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A discriminated base dispatches to the models its mapping names, looking through a subtype that
 * declares no discriminator.** See `intermediate.tsp`.
 *
 * The dispatch was built from the base's direct subtypes, so `Animal` -> `Mammal` (no `kind`) ->
 * `Cat` dispatched to `Mammal`. With no literal `kind` to dispatch on, Zod threw "Invalid discriminated
 * union option" on every parse, so a server answered 500 to anything carrying an `Animal`; and `Cat`,
 * which the document's mapping names for `"cat"`, was not in the dispatch at all.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let animal: ZodType;
let byDocument: (value: unknown) => boolean;
let mapping: unknown;

beforeAll(async () => {
	compiled = await compileFixture(here, "intermediate", { outName: "intermediate" });
	animal = ((await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>)[
		"animalSchema"
	] as ZodType;
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		// As the fixture was compiled: an unsealed document graded against a sealed validator
		// hides any disagreement about which properties may exist.
		"seal-object-schemas": true,
	});
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as { components: { schemas: Record<string, { discriminator?: { mapping?: unknown } }> } };
	mapping = document.components.schemas["Animal"]?.discriminator?.mapping;
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	byDocument = ajv.compile({
		$ref: "#/components/schemas/Animal",
		components: document.components,
	}) as (value: unknown) => boolean;
}, 300_000);

const parse = (value: unknown): boolean => animal.safeParse(value).success;

describe("a discriminated base with a subtype that declares no discriminator", () => {
	it("compiles without a diagnostic, beside a mapping that names the grandchild", () => {
		expect(compiled.diagnostics).toEqual([]);
		expect(mapping).toEqual({
			cat: "#/components/schemas/Cat",
			bird: "#/components/schemas/Bird",
		});
	});

	it("answers every value without throwing", () => {
		for (const value of [
			{ kind: "cat", name: "c", legs: 4, whiskers: 9 },
			{ kind: "bird", name: "b", wingspan: 1 },
			{ kind: "mammal", name: "m", legs: 4 },
			{ kind: "dog", name: "d" },
			{ name: "n" },
		]) {
			expect(() => animal.safeParse(value)).not.toThrow();
		}
	});

	it("answers every value as the document's base does, and hands back the subtype a valid one names", () => {
		const values = [
			{ kind: "cat", name: "c", legs: 4, whiskers: 9 },
			{ kind: "cat", name: "c" },
			{ kind: "bird", name: "b", wingspan: 1 },
			{ kind: "mammal", name: "m", legs: 4 },
			{ kind: "dog", name: "d" },
			{ name: "n" },
		];
		for (const value of values) expect(parse(value), JSON.stringify(value)).toBe(byDocument(value));
		expect(byDocument({ name: "n" })).toBe(false);
		// A valid `Cat` - `whiskers`, and `legs` through `Mammal` - comes back as one.
		expect(animal.parse({ kind: "cat", name: "c", legs: 4, whiskers: 9 })).toEqual({
			kind: "cat",
			name: "c",
			legs: 4,
			whiskers: 9,
		});
	});
});
