import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Overrides and discriminators where the document's `allOf` decides what a value is.** See
 * `inheritanceedges.tsp`. Each was found by grading against the document after the first rewrite of
 * how a subtype is flattened:
 *
 * - an encoding added to an inherited plain property, or a property renamed onto another inherited
 *   one's wire name, was validated as the subtype's declaration alone, where no value is both;
 * - a list overriding a constrained one was intersected as a type, so the emitted wire contract did
 *   not compile - the list now takes the ancestor's constraints;
 * - a union holding a constrained scalar lost the constraint under a literal override;
 * - `kind: never` hid the `string` openapi3 adds in its place, and a `kind: int32` declared above
 *   the model naming the discriminator hid the same `string` beside it;
 * - a template instance adding only an optional property was refused, where the document accepts
 *   every value that leaves it out.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let byDocument: (component: string, value: unknown) => boolean;

beforeAll(async () => {
	compiled = await compileFixture(here, "inheritanceedges", { outName: "inheritanceedges" });
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

const DATE = "2020-01-01T00:00:00Z";
const CASES: readonly (readonly [string, readonly unknown[]])[] = [
	[
		"Ev",
		[
			{ n: 5, when: DATE },
			{ n: "5", when: DATE },
		],
	],
	[
		"EvN",
		[
			{ n: "5", when: DATE },
			{ n: 5, when: DATE },
		],
	],
	[
		"EvW",
		[
			{ n: 5, when: 1 },
			{ n: 5, when: DATE },
		],
	],
	[
		"DogKennel",
		[
			{ dogs: [{ name: "a", barks: true }] },
			{ dogs: [1, 2, 3].map((i) => ({ name: `d${i}`, barks: true })) },
			{ dogs: [{ name: "a" }] },
		],
	],
	["Ab", [{ letters: ["a"] }, { letters: ["a", "b", "a"] }, { letters: ["c"] }]],
	[
		"PlainSub",
		[
			{ b: "s", t: { name: "n" } },
			{ b: 1, t: { name: "n" } },
		],
	],
	[
		"ToySub",
		[
			{ b: 1, t: { name: "n" } },
			{ b: 1, t: "s" },
		],
	],
	["Coded", [{ code: "abc" }, { code: null }, { code: "abcd" }]],
	["CodedX", [{ code: "abcdefgh" }]],
	["NeverKind", [{ kind: "x", name: "n" }, { name: "n" }]],
	[
		"Rooted",
		[
			{ kind: 1, name: "n" },
			{ kind: "x", name: "n" },
		],
	],
	["OptHolder", [{ plant: { name: "rose" } }, { plant: { name: "rose", extra: "x" } }]],
	[
		"MixedX",
		[
			{ a: 100, b: "ab" },
			{ a: "abcd", b: "ab" },
			{ a: 100, b: 1 },
		],
	],
	["MultiX", [{ v: "a" }, { v: ["a"] }]],
	[
		"WX",
		[
			{ w: "abc", ws: ["abc"] },
			{ w: "abcdefg", ws: ["abc"] },
			{ w: "abc", ws: ["abcdefg"] },
		],
	],
	["RX", [{ r: { a: 1 } }, { r: { a: 1.5 } }]],
	["RenX", [{ t: "x" }, {}]],
	[
		"Rooted2",
		[
			{ kind: "x", name: "n" },
			{ kind: 1, name: "n" },
		],
	],
	[
		"Base3",
		[
			{ kind: "abc", name: "n" },
			{ kind: "abcdef", name: "n" },
		],
	],
	["EX", [{ at: 1_600_000_000 }, { at: 1 }]],
	["Fig", [{ type: "sq", side: 1 }, { type: "ci", radius: 1 }, { type: "tri" }]],
	[
		"HSub",
		[
			{ code: "abc", name: "n" },
			{ code: "abcd", name: "n" },
		],
	],
];

describe("a model published as allOf its base", () => {
	it("compiles with no diagnostic of this emitter's, beside the header @typespec/http ignores", () => {
		expect(compiled.diagnostics.filter((d) => d.code.startsWith("typespec-http-zod/"))).toEqual([]);
		expect(compiled.diagnostics.map((d) => d.code)).toEqual(["@typespec/http/metadata-ignored"]);
	});

	for (const [component, values] of CASES) {
		it(`${component}: answers every value as the document does`, () => {
			for (const value of values) {
				expect(
					validatorOf(component).safeParse(value).success,
					`${component} ${JSON.stringify(value)}`,
				).toBe(byDocument(component, value));
			}
		});
	}

	it("grades values the document accepts as well as ones it refuses", () => {
		const verdicts = CASES.flatMap(([component, values]) =>
			values.map((value) => byDocument(component, value)),
		);
		expect(verdicts).toContain(true);
		expect(verdicts).toContain(false);
		// And the ones no value satisfies are refused whatever is sent.
		for (const component of ["EvN", "EvW", "PlainSub", "ToySub", "CodedX", "Rooted"]) {
			const [, values] = CASES.find(([name]) => name === component) ?? ["", []];
			expect(values.map((value) => byDocument(component, value))).not.toContain(true);
		}
	});

	it("emits a set that compiles, the validator and contract types identical", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
