import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A subtype no dispatch can hold is refused, and its base still validates as the document's
 * base.** See `subtyperefusals.tsp`.
 *
 * - `kind: "lab" | string` and `@encodedName` on a subtype's `kind` made Zod throw "Invalid
 *   discriminated union option" - on import, or on every parse of the base.
 * - `kind: "cobra"` under `@maxLength(3)`, and a string `kind` under a base that encodes it as an
 *   integer, are subtypes no value is, and the dispatch accepted them.
 * - `Potted<string> extends Plant`: openapi3 seals `Plant`, not counting a template instance as
 *   derived, so the document refuses every `Potted<string>` carrying `pot`, which it requires.
 *
 * And what is NOT refused: an envelope-less variant no value is leaves the union to the others, as a
 * `oneOf` with an unsatisfiable member does, and a model redeclared over an unrelated one is merged
 * with it key by key.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let byDocument: (component: string, value: unknown) => boolean;

beforeAll(async () => {
	compiled = await compileFixture(here, "subtyperefusals", { outName: "subtyperefusals" });
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		"seal-object-schemas": true,
	});
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as { components: Record<string, unknown> };
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	byDocument = (component, value) =>
		ajv.validate(
			{ $ref: `#/components/schemas/${component}`, components: document.components },
			value,
		);
}, 300_000);

describe("a subtype no dispatch can hold", () => {
	it("is refused, each once, as an error naming why", () => {
		const reported = compiled.program.diagnostics.map((d) => ({
			code: d.code,
			severity: d.severity,
			message: d.message,
		}));
		expect(reported.map((d) => `${d.severity} ${d.code}`).toSorted()).toEqual([
			...Array.from({ length: 7 }, () => "error typespec-http-zod/invalid-subtype-discriminator"),
			...Array.from({ length: 5 }, () => "error typespec-http-zod/sealed-base-extended"),
			...Array.from({ length: 2 }, () => "error typespec-http-zod/undeclared-discriminator"),
			"error typespec-http-zod/unrepresentable-override",
			"error typespec-http-zod/unrepresentable-override",
		]);
		const text = reported.map((d) => d.message).join("\n");
		for (const named of [
			"'Cobra' is named by the mapping of 'Snake''s discriminator 'kind', and it fixes 'kind' as 'cobra', which 'Snake' refuses with '@maxLength(3)'",
			"'CodedA' is named by the mapping of 'Coded''s discriminator 'kind', and it fixes 'kind' as a string, which 'Coded' publishes as a JSON integer",
			"'Lab' is named by the mapping of 'Dog''s discriminator 'kind', and it publishes 'kind' as",
			"'Eagle' is named by the mapping of 'Bird''s discriminator 'kind', and it publishes 'kind' as",
			"'Shark' is named by the mapping of 'Fish''s discriminator 'kind'",
			"which 'Potted<string>' adds",
			"'Viper' is named by the mapping of 'Adder''s discriminator 'kind', and it fixes 'kind' as 'viper', which 'Adder' refuses",
			"which 'Twice<string>' adds",
			"which 'Twice<int32>' adds",
			"'DogN' declares it as no one fixed value",
			"'BirdN' does not declare it",
			"which 'Capped<\"a\">' adds",
			"which 'Capped<\"c\">' adds",
			"'NodeB.child' is held to 'NodeA.child' as well, through 'allOf', and merging the two declarations refers back to itself",
			"'CatR2.p' is held to 'CatR.p' as well, through 'allOf', and merging the two declarations refers back to itself",
		]) {
			expect(text).toContain(named);
		}
	});

	it("leaves a module that loads, and a base that validates as the document's", () => {
		const cases: readonly (readonly [string, unknown, string])[] = [
			["Snake", { kind: "cobra", length: 1 }, "snakeSchema"],
			["Snake", { kind: "asp", length: 1 }, "snakeSchema"],
			["Coded", { kind: "a", name: "n" }, "codedSchema"],
			["Coded", { kind: 1, name: "n" }, "codedSchema"],
			["Dog", { kind: "lab", weight: 1, colour: "b" }, "dogSchema"],
			["Dog", { kind: "golden", weight: 1 }, "dogSchema"],
			["Dog", { weight: 1 }, "dogSchema"],
			["Bird", { kind: "eagle", k: "eagle", wingspan: 1, talons: 1 }, "birdSchema"],
			["Fish", { kind: "shark", age: 1, sharktype: "saw" }, "fishSchema"],
			["Fish", { kind: "salmon" }, "fishSchema"],
			// A subtype no value is, used directly: refused, and accepting nothing, as the document.
			["Cobra", { kind: "cobra", length: 1 }, "cobraSchema"],
			["Adder", { kind: "viper", n: 1 }, "adderSchema"],
			["Adder", { kind: "abc", n: 1 }, "adderSchema"],
			["King", { kind: "krait", sub: "king", length: 1, crown: 1 }, "kingSchema"],
			// The union without the variant no value is: a cat, and never a horse.
			["Farm", { type: "cat", name: "n" }, "farmSchema"],
			["Farm", { type: "horsey", name: "n" }, "farmSchema"],
			// Merged with the unrelated model above: its `@maxLength(2)` holds, and its default does not throw.
			["TaggedX", { meta: { tag: "ab" } }, "taggedXSchema"],
			["TaggedX", { meta: { tag: "abc" } }, "taggedXSchema"],
			["KeeperX", { meta: { tag: "t" } }, "keeperXSchema"],
			["KeeperX", { meta: { tag: "t", level: "2" } }, "keeperXSchema"],
			// The union is its one variant a value can be, and parses without throwing.
			["Jars", { kind: "b", v: "x" }, "jarsSchema"],
			["Jars", { kind: "a", cap: "x" }, "jarsSchema"],
		];
		const verdicts = cases.map(([component, value, identifier]) => {
			const verdict = (schemas[identifier] as ZodType).safeParse(value).success;
			expect(verdict, `${component} ${JSON.stringify(value)}`).toBe(byDocument(component, value));
			return verdict;
		});
		expect(verdicts).toContain(true);
		expect(verdicts).toContain(false);
		// The redeclaration's default fills an absent `level`, where the intersection threw.
		const keeper = schemas["keeperXSchema"] as ZodType;
		expect(keeper.parse({ meta: { tag: "t" } })).toEqual({ meta: { tag: "t", level: 1 } });
	});

	it("emits a set that compiles, a refused type `never` on both sides", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
