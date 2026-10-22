import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A model validates as the document publishes it: `allOf` its base, keyed on the wire name.** See
 * `overrides.tsp`.
 *
 * Each subtype was flattened to the most derived declaration of each TypeSpec property, so:
 *
 * - a subtype redeclaring `name: string` under `Pet`'s `@maxLength(3)` accepted `"rexie"`, and so
 *   did the base, whose dispatch handed it to the subtype - looser than the document;
 * - a discriminator declared `kind?: string` was optional, where openapi3 always requires it;
 * - a base's `kind` renamed `k` was replaced by the subtype's `kind`, losing the `k` the base
 *   requires, and a base's `kind` renamed `type` beside a subtype's own `type` was written as two
 *   `type` keys, which does not compile.
 *
 * Every verdict is graded by Ajv against the document, compiled sealed as the fixture is.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let byDocument: (component: string, value: unknown) => boolean;

beforeAll(async () => {
	compiled = await compileFixture(here, "overrides", { outName: "overrides" });
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

const validatorOf = (component: string): ZodType =>
	schemas[`${component.charAt(0).toLowerCase()}${component.slice(1)}Schema`] as ZodType;

const CASES: readonly (readonly [string, readonly unknown[]])[] = [
	[
		"Pet",
		[
			{ kind: "dog", name: "rex", age: 1, barks: true },
			{ kind: "dog", name: "rexie", age: 1, barks: true },
			{ kind: "dog", name: "rex", age: -1, barks: true },
			{ kind: "cat", name: "tom", age: 2 },
		],
	],
	[
		"Dog",
		[
			{ kind: "dog", name: "rex", age: 1, barks: true },
			{ kind: "dog", name: "rexie", age: 1, barks: true },
		],
	],
	["Loose", [{ kind: "x", name: "n" }, { kind: "a", name: "n" }, { name: "n" }]],
	["Defaulted", [{ kind: "d", name: "n" }, { name: "n" }]],
	[
		"Renamed",
		[
			{ k: "x", kind: "a", name: "n", extra: 1 },
			{ k: "x", kind: "z", name: "n" },
			{ kind: "a", name: "n", extra: 1 },
			{ k: "x", name: "n" },
		],
	],
	[
		"RenamedA",
		[
			{ k: "x", kind: "a", name: "n", extra: 1 },
			{ kind: "a", name: "n", extra: 1 },
		],
	],
	["Shape", [{ type: "circle", area: 1, radius: 1 }, { type: "square", area: 1 }, { area: 1 }]],
	[
		"Circle",
		[
			{ type: "circle", area: 1, radius: 1 },
			{ type: "circle", radius: 1 },
		],
	],
	[
		"Animal",
		[{ kind: "pet", name: "p", v: "s" }, { kind: "x", name: "a", extra: 1 }, { name: "a" }],
	],
	[
		"PetString",
		[
			{ kind: "pet", name: "p", v: "s" },
			{ kind: "pet", name: "p" },
		],
	],
];

describe("a model published as allOf its base", () => {
	it("reports only the default on a discriminator, which can never apply", () => {
		expect(compiled.diagnostics).toEqual([
			{ code: "typespec-http-zod/default-on-required-property", severity: "warning" },
		]);
		expect(compiled.program.diagnostics[0]?.message).toContain("'kind' is a discriminator");
	});

	for (const [component, values] of CASES) {
		it(`${component}: answers every value as the document does`, () => {
			const verdicts = values.map((value) => {
				const verdict = validatorOf(component).safeParse(value).success;
				expect(verdict, `${component} ${JSON.stringify(value)}`).toBe(byDocument(component, value));
				return verdict;
			});
			expect(verdicts).toContain(true);
			expect(verdicts).toContain(false);
		});
	}

	it("hands back a valid instance of the subtype its discriminator names as that subtype", () => {
		expect(validatorOf("Pet").parse({ kind: "dog", name: "rex", age: 1, barks: true })).toEqual({
			kind: "dog",
			name: "rex",
			age: 1,
			barks: true,
		});
		expect(validatorOf("Renamed").parse({ k: "x", kind: "a", name: "n", extra: 1 })).toEqual({
			k: "x",
			kind: "a",
			name: "n",
			extra: 1,
		});
		expect(validatorOf("Animal").parse({ kind: "pet", name: "p", v: "s" })).toEqual({
			kind: "pet",
			name: "p",
			v: "s",
		});
	});

	it("emits a set that compiles, the validator and contract types identical", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
