import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodType } from "zod";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "./support/compile-fixture.js";

/**
 * **The emitted validators accept what the document permits and reject what it forbids.**
 *
 * **Nothing else here asks that.** The differential compares the validator to the document as two
 * descriptions - it can report perfect agreement about a schema that throws the moment a value
 * reaches it. `emit.test.ts` compiles the output, which is a different claim again: a `z.object`
 * built wrongly still compiles. This suite runs the validators against values.
 *
 * **Every arm is a PAIR.** A test that only checks acceptance passes against `z.any()`, and one
 * that only checks rejection passes against `z.never()`. Neither is worth writing alone, and the
 * emitter has shipped both failures: a validator that stripped every declared field while accepting
 * the object, and one that rejected every conformant caller.
 *
 * **The module is IMPORTED, which is itself an assertion.** Zod's documented recursion idiom is
 * incompatible with its own strictness suffixes - `.strict()`, `.loose()` and `.catchall()` read
 * `shape` eagerly, so a recursive model built with one throws `Cannot access 'X' before
 * initialization` during module initialisation. A recursive schema that cannot be loaded is not a
 * schema, and the failure happens at `import` rather than in any arm below.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let service: Record<string, unknown>;
let constraints: Record<string, unknown>;

beforeAll(async () => {
	const s = await compileFixture(join(here, "reference"), "service", { outName: "service-accept" });
	const c = await compileFixture(join(here, "reference"), "constraints", {
		outName: "constraints-accept",
	});
	service = (await import(join(s.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
	constraints = (await import(join(c.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
}, 300_000);

/** Named rather than positional, so a failure says which schema and which value. */
function accepts(schema: unknown, value: unknown): boolean {
	return (schema as ZodType).safeParse(value).success;
}

const WIDGET = { id: "w", name: "Sprocket", weight: 3, colour: "red", tags: ["a"] };

describe("closed models", () => {
	it("accepts a conformant body and rejects a surplus property", () => {
		/**
		 * **Both directions, because the failure modes are opposite and both have shipped.** Under
		 * `seal-object-schemas` the document says `unevaluatedProperties: {not: {}}`, so a surplus key is
		 * a rejection. A validator that merely STRIPS it accepts the object and silently discards data;
		 * one that rejects a declared key refuses every conformant caller.
		 */
		expect(accepts(service["widgetSchema"], WIDGET)).toBe(true);
		expect(accepts(service["widgetSchema"], { ...WIDGET, surplus: true })).toBe(false);
	});

	it("keeps every declared property required", () => {
		for (const missing of ["id", "name", "weight", "colour", "tags"]) {
			const body: Record<string, unknown> = { ...WIDGET };
			delete body[missing];
			expect(accepts(service["widgetSchema"], body), `${missing} must be required`).toBe(false);
		}
	});

	it("tells optional and nullable apart", () => {
		/**
		 * `retiredOn?: IsoDate | null` is BOTH, and they are different facts. An emitter that collapses
		 * them accepts `null` for every optional property, or refuses it for one the document permits.
		 */
		expect(accepts(service["widgetSchema"], { ...WIDGET, retiredOn: "2026-01-01" })).toBe(true);
		expect(accepts(service["widgetSchema"], { ...WIDGET, retiredOn: null })).toBe(true);
		expect(accepts(service["widgetSchema"], WIDGET)).toBe(true);
		// Still constrained when present: the pattern comes from the scalar the property NAMES.
		expect(accepts(service["widgetSchema"], { ...WIDGET, retiredOn: "not-a-date" })).toBe(false);
	});
});

describe("open and typed shapes", () => {
	it("keeps declared properties checked on a model that also has an indexer", () => {
		/**
		 * **Reading the indexer first emits a dictionary**, which accepts the object and strips every
		 * declared field - so the pinned properties silently stop being checked while every test that
		 * only asserts `success` stays green. `id` must still be required.
		 */
		expect(accepts(service["openWidgetSchema"], { id: "x", anything: 1 })).toBe(true);
		expect(accepts(service["openWidgetSchema"], { anything: 1 })).toBe(false);
	});

	it("enforces a typed catchall's value type", () => {
		expect(accepts(service["typedCatchallSchema"], { id: "x", extra: "text" })).toBe(true);
		expect(accepts(service["typedCatchallSchema"], { id: "x", extra: 7 })).toBe(false);
	});

	it("enforces a dictionary's value union", () => {
		expect(accepts(service["attributesSchema"], { a: "s", b: 1, c: true })).toBe(true);
		expect(accepts(service["attributesSchema"], { a: [] })).toBe(false);
	});

	it("accepts an all-optional model empty, and still refuses an unknown key", () => {
		expect(accepts(service["knownFlagsSchema"], {})).toBe(true);
		expect(accepts(service["knownFlagsSchema"], { isDraft: true })).toBe(true);
		expect(accepts(service["knownFlagsSchema"], { nope: true })).toBe(false);
	});
});

describe("polymorphism", () => {
	it("validates against the variant the discriminator names", () => {
		expect(accepts(service["shapeSchema"], { kind: "circle", label: "c", radius: 1 })).toBe(true);
		expect(accepts(service["shapeSchema"], { kind: "square", label: "s", side: 2 })).toBe(true);
	});

	it("refuses a variant's body under the wrong discriminator, and an unknown one", () => {
		/**
		 * **A base emitted as its own shape validates none of its polymorphism.** `{kind, label}`
		 * would satisfy it while `radius` went unchecked - a polymorphic endpoint accepting anything
		 * that names a kind.
		 */
		expect(accepts(service["shapeSchema"], { kind: "circle", label: "c", side: 2 })).toBe(false);
		expect(accepts(service["shapeSchema"], { kind: "hexagon", label: "h" })).toBe(false);
		expect(accepts(service["shapeSchema"], { kind: "circle", label: "", radius: 1 })).toBe(false);
	});
});

describe("recursion", () => {
	it("loaded at all, which is most of the assertion", () => {
		// See the file docblock: a recursive schema built with a strictness suffix throws on import.
		expect(service["nodeSchema"]).toBeDefined();
	});

	it("validates arbitrarily deep, and still rejects at depth", () => {
		const deep = { label: "a", children: [{ label: "b", children: [{ label: "c" }] }] };
		expect(accepts(service["nodeSchema"], deep)).toBe(true);
		const bad = { label: "a", children: [{ label: "b", children: [{ label: 7 }] }] };
		expect(accepts(service["nodeSchema"], bad)).toBe(false);
	});
});

describe("vocabularies", () => {
	it("accepts a declared member and refuses one the enum does not name", () => {
		expect(accepts(service["widgetSchema"], { ...WIDGET, colour: "green" })).toBe(true);
		// The WIRE value, not the member name - `deepBlue: "deep-blue"`.
		expect(accepts(service["widgetSchema"], { ...WIDGET, colour: "deep-blue" })).toBe(true);
		expect(accepts(service["widgetSchema"], { ...WIDGET, colour: "deepBlue" })).toBe(false);
		expect(accepts(service["widgetSchema"], { ...WIDGET, colour: "puce" })).toBe(false);
	});
});

describe("constraints", () => {
	const strings = (over: Record<string, unknown>): Record<string, unknown> => ({
		name: "n",
		reference: "AB-1234",
		slug: "a-slug",
		handle: "abcd",
		...over,
	});
	const numbers = (over: Record<string, unknown>): Record<string, unknown> => ({
		percent: 50,
		rate: 0.5,
		...over,
	});
	const collections = (over: Record<string, unknown>): Record<string, unknown> => ({
		tags: ["a"],
		ids: ["i"],
		aliases: ["AB-1234"],
		scores: [1],
		payloads: [1],
		attachments: ["x"],
		buckets: [{ a: 1 }],
		...over,
	});

	it("enforces minLength and maxLength", () => {
		expect(accepts(constraints["stringBoundsSchema"], strings({}))).toBe(true);
		expect(accepts(constraints["stringBoundsSchema"], strings({ name: "" }))).toBe(false);
		expect(accepts(constraints["stringBoundsSchema"], strings({ name: "x".repeat(65) }))).toBe(
			false,
		);
	});

	/**
	 * **A length bound is counted in CODE POINTS, which is what the document means and what
	 * `String.prototype.length` does not report.**
	 *
	 * `handle` is bounded `[3, 8]`. Two emoji are 2 code points and 4 UTF-16 units, so a validator
	 * counting units accepts them against `minLength: 3` - a payload the document forbids reaching a
	 * handler. Eight are 8 code points and 16 units, so the same validator refuses a payload the
	 * document permits. Both were live on zod 4.4.3 and neither was visible to any arm here, because
	 * `portability.test.ts` requires ASCII source and no fixture had ever carried an astral character.
	 * The escape is ASCII; the value is not.
	 */
	it("counts a length bound in code points, not UTF-16 units", () => {
		const emoji = (count: number): string => "\u{1F600}".repeat(count);
		expect(accepts(constraints["stringBoundsSchema"], strings({ handle: emoji(2) }))).toBe(false);
		expect(accepts(constraints["stringBoundsSchema"], strings({ handle: emoji(3) }))).toBe(true);
		expect(accepts(constraints["stringBoundsSchema"], strings({ handle: emoji(8) }))).toBe(true);
		expect(accepts(constraints["stringBoundsSchema"], strings({ handle: emoji(9) }))).toBe(false);
	});

	it("enforces a pattern from the scalar a property names, and one applied directly", () => {
		expect(accepts(constraints["stringBoundsSchema"], strings({ reference: "ab-1234" }))).toBe(
			false,
		);
		expect(accepts(constraints["stringBoundsSchema"], strings({ slug: "Not A Slug" }))).toBe(false);
	});

	it("enforces inclusive bounds", () => {
		expect(accepts(constraints["numericBoundsSchema"], numbers({ percent: 0 }))).toBe(true);
		expect(accepts(constraints["numericBoundsSchema"], numbers({ percent: 100 }))).toBe(true);
		expect(accepts(constraints["numericBoundsSchema"], numbers({ percent: -1 }))).toBe(false);
		expect(accepts(constraints["numericBoundsSchema"], numbers({ percent: 101 }))).toBe(false);
	});

	it("enforces EXCLUSIVE bounds as exclusive", () => {
		/**
		 * **Collapsing these to inclusive is a real defect with a quiet symptom.** `.min(0)` accepts a
		 * zero rate; `@minValueExclusive(0)` is `.gt(0)` and does not. The boundary is the whole point,
		 * so the boundary is what is tested.
		 */
		expect(accepts(constraints["numericBoundsSchema"], numbers({ rate: 0 }))).toBe(false);
		expect(accepts(constraints["numericBoundsSchema"], numbers({ rate: 1 }))).toBe(false);
		expect(accepts(constraints["numericBoundsSchema"], numbers({ rate: 0.0001 }))).toBe(true);
	});

	it("enforces minItems and maxItems", () => {
		expect(accepts(constraints["collectionBoundsSchema"], collections({ tags: [] }))).toBe(false);
		expect(
			accepts(
				constraints["collectionBoundsSchema"],
				collections({ tags: ["a", "b", "c", "d", "e", "f"] }),
			),
		).toBe(true);
		expect(
			accepts(
				constraints["collectionBoundsSchema"],
				collections({ tags: ["a", "b", "c", "d", "e", "f", "g"] }),
			),
		).toBe(false);
	});

	it("leaves an open element open, without letting the array itself go unchecked", () => {
		// `payloads: unknown[]` - the document says `items: {}`, so anything goes INSIDE the array.
		expect(
			accepts(constraints["collectionBoundsSchema"], collections({ payloads: [1, "a", null] })),
		).toBe(true);
		// But it is still an array.
		expect(
			accepts(constraints["collectionBoundsSchema"], collections({ payloads: "not-an-array" })),
		).toBe(false);
	});

	it("enforces an element's own constraint through the scalar it names", () => {
		expect(accepts(constraints["collectionBoundsSchema"], collections({ aliases: ["nope"] }))).toBe(
			false,
		);
	});
});
