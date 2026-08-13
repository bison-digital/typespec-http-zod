import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **`@encode` decides what a value looks like ON THE WIRE, and the validator has to agree.**
 *
 * The differential proves the emitted *type* now matches the document's. It cannot prove the
 * validator accepts an encoded value, because both artefacts saying "string" is agreement about a
 * word. These arms send what the contract actually describes.
 *
 * **Each arm is paired with its opposite.** `@encode` is the one change where the wrong answer is
 * the *declared* type - an arm that only checked "the encoded form is accepted" would pass on a
 * validator that accepts everything, and an arm that only checked "the declared form is rejected"
 * would pass on one that accepts nothing. Both, over the same property, or neither proves anything.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a validator checks the encoded form, not the declared one", () => {
	let schema: ZodType;
	let compiled: CompiledFixture;
	const parse = (value: unknown): boolean => schema.safeParse(value).success;
	const body = (overrides: Record<string, unknown>): Record<string, unknown> => ({
		tags: "a,b,c",
		elapsed: 1.5,
		occurredAt: 1_700_000_000,
		counter: "9007199254740993",
		plain: "text",
		...overrides,
	});

	beforeAll(async () => {
		compiled = await compileFixture(here, "wire");
		const module = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
			string,
			ZodType
		>;
		schema = module.encodedSchema as ZodType;
	});

	it("compiles without an error diagnostic, and emits the model", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(schema).toBeDefined();
	});

	it("accepts a body carrying every value in its encoded form", () => {
		expect(parse(body({}))).toBe(true);
	});

	it("reads a delimited list as a STRING, not an array", () => {
		expect(parse(body({ tags: "a,b,c" }))).toBe(true);
		// The declared type. This is what the emitter used to require, and the document forbids it.
		expect(parse(body({ tags: ["a", "b", "c"] }))).toBe(false);
	});

	it("reads a seconds-encoded duration as a NUMBER, not an ISO 8601 string", () => {
		expect(parse(body({ elapsed: 1.5 }))).toBe(true);
		expect(parse(body({ elapsed: "PT1.5S" }))).toBe(false);
	});

	it("reads a unix timestamp as an INTEGER, not an RFC 3339 string", () => {
		expect(parse(body({ occurredAt: 1_700_000_000 }))).toBe(true);
		expect(parse(body({ occurredAt: "2023-11-14T22:13:20Z" }))).toBe(false);
	});

	it("reads a string-encoded number as a STRING", () => {
		expect(parse(body({ counter: "42" }))).toBe(true);
		expect(parse(body({ counter: 42 }))).toBe(false);
	});

	it("leaves an unencoded property alone, so the rule is not applied to everything", () => {
		// Without this, an emitter that encoded every property as a string would pass every arm above.
		expect(parse(body({ plain: "text" }))).toBe(true);
		expect(parse(body({ plain: 42 }))).toBe(false);
	});
});
