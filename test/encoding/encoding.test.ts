import { readFileSync } from "node:fs";
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
		capacity: "42",
		rate: "0.5",
		size: "2048",
		label: "ok",
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

/**
 * **A bound on a number the wire carries as text.** `@encode(string)` is legal on a numeric property
 * and TypeSpec checks the bound against the NUMBER, while the emitted expression is `z.string()`.
 * Folding the two together made `@minValue` a length check, which answers the opposite question -
 * and the exclusive form emitted `z.string().gt(0)`, which is not a function, so the module threw on
 * import and every request to the service failed with it.
 *
 * **Both halves matter.** The bound cannot be enforced either: the document publishes `minimum` on a
 * `type: string` schema and JSON Schema ignores it, so a validator that checked it would refuse what
 * the published contract accepts. The emitter reports that rather than guessing.
 */
describe("a numeric bound on a value encoded as a string", () => {
	let schemas: string;
	let schema: ZodType;
	let compiled: CompiledFixture;
	const body = (overrides: Record<string, unknown>): Record<string, unknown> => ({
		tags: "a,b,c",
		elapsed: 1.5,
		occurredAt: 1_700_000_000,
		counter: "9007199254740993",
		capacity: "42",
		rate: "0.5",
		size: "2048",
		label: "ok",
		plain: "text",
		...overrides,
	});

	beforeAll(async () => {
		compiled = await compileFixture(here, "wire", { outName: "wire-bounds" });
		schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		const module = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
			string,
			ZodType
		>;
		schema = module["encodedSchema"] as ZodType;
	}, 300_000);

	it("loads at all, which an exclusive bound on a string expression stopped it doing", () => {
		expect(schema, "z.string().gt(0) is not a function").toBeDefined();
	});

	it("accepts a value inside the declared bound whose text is shorter than it", () => {
		// `.min(10)` on the string refused this: two characters, and a capacity of 42 the spec allows.
		expect(schema.safeParse(body({ capacity: "42" })).success).toBe(true);
	});

	it("emits no bound at all for either form, rather than one that answers another question", () => {
		expect(/\n\tcapacity: ([^\n]+),/.exec(schemas)?.[1]).toBe("z.string()");
		expect(/\n\trate: ([^\n]+),/.exec(schemas)?.[1]).toBe("z.string()");
	});

	it("reports each one, naming what to write instead", () => {
		const warned = compiled.program.diagnostics.filter(
			(diagnostic) => diagnostic.code === "typespec-http-zod/unenforceable-encoded-bound",
		);
		// Three properties, not five bounds: reported per property rather than per bound. The
		// inclusive pair, the exclusive one, and the property whose SCALAR carries the encoding -
		// that third one fires only because `encodesAsString` asks the scalar as well.
		expect(warned.length).toBe(3);
		expect(warned.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
		expect(String(warned[0]?.message)).toContain("@pattern");
		// Named, so the count cannot be satisfied by three of the wrong thing.
		expect(warned.map((diagnostic) => String(diagnostic.message)).join("\n")).toContain("size");
	});

	it("still enforces a length bound on a value that really is a string", () => {
		expect(schema.safeParse(body({ label: "x" })).success).toBe(false);
		expect(schema.safeParse(body({ label: "far too long" })).success).toBe(false);
		expect(schema.safeParse(body({ label: "ok" })).success).toBe(true);
	});
});
