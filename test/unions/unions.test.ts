import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A `@discriminated` union is a choice between WRAPPINGS of its variants.**
 *
 * `z.discriminatedUnion("kind", [catSchema, dogSchema])` over models that carry no `kind` **matches
 * nothing** - every request to a polymorphic endpoint failed, and the suite was green. The
 * differential could not see it either: it read a discriminated component as an object, so both
 * sides described "not an object" and agreed.
 *
 * **`envelope: "none"` is accepted only where the variant declares the discriminator itself**, and
 * refused otherwise - see `undeclared.tsp`. openapi3 publishes the variant unchanged, so unless it
 * declares the property the document names a discriminator it never requires, which OpenAPI 3.1
 * forbids. The emitter briefly injected the property to compensate; that enforced a rule no contract
 * stated, and enforcing what the document does not say is the defect this whole effort exists to
 * remove, whatever label is put on it.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a discriminated union validates the shape that goes on the wire", () => {
	let schemas: Record<string, ZodType>;
	let compiled: CompiledFixture;
	const accepts = (name: string, value: unknown): boolean =>
		(schemas[name] as ZodType).safeParse(value).success;

	beforeAll(async () => {
		compiled = await compileFixture(here, "pets");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	});

	it("compiles without an error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("declares the envelope models the document publishes as components", () => {
		// openapi3 synthesises a component per variant, named `union.type.name + capitalize(variant)`.
		// There is no TypeSpec type for these, so nothing keyed on `Type` could ever have declared them.
		const expected = [
			"petWithEnvelopeSchema",
			"petWithEnvelopeCatSchema",
			"petWithEnvelopeDogSchema",
			"petWithCustomNamesCatSchema",
			"petWithCustomNamesDogSchema",
		];
		expect(expected.filter((identifier) => schemas[identifier] === undefined)).toEqual([]);
	});

	it("wraps the variant under `kind` and `value` by default", () => {
		expect(
			accepts("petWithEnvelopeSchema", { kind: "cat", value: { name: "W", meow: true } }),
		).toBe(true);
		// The bare variant - what the emitter used to require, and what the wire never carries.
		expect(accepts("petWithEnvelopeSchema", { name: "W", meow: true })).toBe(false);
	});

	it("still validates INSIDE the envelope", () => {
		// Otherwise the wrapper is a shape with an unchecked payload, which is the same defect one
		// layer out: a request that succeeds and carries nonsense.
		expect(accepts("petWithEnvelopeSchema", { kind: "cat", value: { name: "W" } })).toBe(false);
		expect(
			accepts("petWithEnvelopeSchema", { kind: "cat", value: { name: "W", bark: false } }),
		).toBe(false);
	});

	it("REJECTS a variant paired with the wrong discriminator", () => {
		// `kind: "dog"` must select `Dog`. Reading the tag but not switching on it would pass the arms
		// above and accept this.
		expect(
			accepts("petWithEnvelopeSchema", { kind: "dog", value: { name: "W", meow: true } }),
		).toBe(false);
		expect(
			accepts("petWithEnvelopeSchema", { kind: "fox", value: { name: "W", meow: true } }),
		).toBe(false);
	});

	it("honours BOTH custom property names", () => {
		expect(
			accepts("petWithCustomNamesSchema", { petType: "cat", petData: { name: "W", meow: true } }),
		).toBe(true);
		// Paired with the default names over the same data, so neither name is hard-coded anywhere.
		expect(
			accepts("petWithCustomNamesSchema", { kind: "cat", value: { name: "W", meow: true } }),
		).toBe(false);
	});

	it('accepts `envelope: "none"` when the variant declares it, adding nothing', () => {
		/**
		 * The only accepted spelling of `envelope: "none"`. The variant
		 * declares `kind`, so the document publishes it as required and the validator enforces exactly
		 * what the contract states.
		 *
		 * **The source check is the point.** Injecting the property anyway is behaviourally
		 * identical, so no amount of parsing values can tell the two apart - which is precisely how
		 * the compensating version survived once already.
		 */
		expect(accepts("releaseSchema", { kind: "part", amount: 5 })).toBe(true);
		expect(accepts("releaseSchema", { kind: "full" })).toBe(true);
		expect(accepts("releaseSchema", { kind: "part" })).toBe(false);
		expect(accepts("releaseSchema", { amount: 5 })).toBe(false);
		const source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		const line = source.split("\n").find((text) => text.includes("export const releaseSchema ="));
		// Asserted present first: `undefined`/`""` would satisfy `not.toContain` and prove nothing.
		expect(line).toContain('z.discriminatedUnion("kind"');
		expect(line).not.toContain(".extend(");
	});
});
