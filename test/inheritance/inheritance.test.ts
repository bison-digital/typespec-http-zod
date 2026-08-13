import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A derived model validates what it inherits.**
 *
 * `model.properties` holds a model's OWN properties, and `baseModel` appeared nowhere in `src/`. A
 * leaf model is also the one openapi3 seals, so the two defects compounded: `Extension extends
 * Element` was emitted as `z.object({level}).strict()`, and the conformance scenario's own documented
 * request body - `{"level": 0, "extension": [...]}` - would come back `400`, naming a key the
 * published contract requires. **Dropping a field is bad; rejecting a conformant request is worse.**
 *
 * Nothing saw it, twice over. The spec it was first built against declared no `extends`, and the
 * differential returned
 * `undefined` for any document schema carrying an `allOf` - so 28 of 226 components were not
 * divergent, they were never compared.
 *
 * The differential now covers the shapes. This file covers the behaviour, which shape agreement
 * cannot: that the emitted validator actually *accepts* an inherited property rather than merely
 * declaring one.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const accepts = (schema: ZodType, value: unknown): boolean => schema.safeParse(value).success;

describe("a derived model carries what it inherits", () => {
	let schemas: Record<string, ZodType>;
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "estate");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	});

	it("compiles without an error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("emits every declaration, so nothing below is vacuous", () => {
		const expected = [
			"houseSchema",
			"cottageSchema",
			"mansionSchema",
			"annexSchema",
			"ledgerSchema",
		];
		expect(expected.filter((identifier) => schemas[identifier] === undefined)).toEqual([]);
	});

	it("ACCEPTS an inherited property on a SEALED derived model", () => {
		/**
		 * The defect, stated as a test. `address` is declared by `Building`; `Cottage` is a leaf and so
		 * is the one openapi3 seals - the combination that turned a missing field into a rejection.
		 *
		 * Written first against `House`, which is **not** sealed because `Mansion` extends it. The
		 * test failed and the emitter was right: sealing a base would make a subtype's own properties
		 * unevaluated against it, so openapi3 leaves it open and this emitter mirrors that rule.
		 */
		expect(
			accepts(schemas.cottageSchema as ZodType, { address: "1 Main St", thatched: true }),
		).toBe(true);
		// Paired with a rejection over the same model, so "accepts" is not just "accepts everything".
		expect(
			accepts(schemas.cottageSchema as ZodType, { address: "1 Main St", thatched: true, x: 1 }),
		).toBe(false);
	});

	it("does NOT seal a base that has subtypes, matching openapi3's own rule", () => {
		// The other direction of the same rule, and the reason the arm above uses a leaf. A validator
		// that sealed `House` would reject the properties `Mansion` adds.
		expect(
			accepts(schemas.houseSchema as ZodType, { address: "a", garden: true, ballrooms: 3 }),
		).toBe(true);
	});

	it("still REQUIRES an inherited property that the base made required", () => {
		// Inheriting the property but losing its requiredness would pass the arm above and still be
		// wrong - the validator would admit a body the document calls invalid.
		expect(accepts(schemas.houseSchema as ZodType, { garden: true })).toBe(false);
		expect(accepts(schemas.houseSchema as ZodType, { address: "1 Main St" })).toBe(false);
	});

	it("keeps an inherited OPTIONAL property optional, and type-checks it", () => {
		expect(
			accepts(schemas.houseSchema as ZodType, { address: "a", garden: false, floors: 2 }),
		).toBe(true);
		expect(
			accepts(schemas.houseSchema as ZodType, { address: "a", garden: false, floors: "two" }),
		).toBe(false);
	});

	it("walks a chain more than one level deep", () => {
		// `Mansion` inherits `garden` from `House` and `address` from `Building`. A one-hop walk would
		// find `garden` and pass every assertion that only looks one level up.
		expect(
			accepts(schemas.mansionSchema as ZodType, { address: "a", garden: true, ballrooms: 3 }),
		).toBe(true);
		expect(accepts(schemas.mansionSchema as ZodType, { garden: true, ballrooms: 3 })).toBe(false);
	});

	it("lets a redeclared property OVERRIDE rather than appear twice", () => {
		// A duplicated key in the emitted object literal is silently legal JavaScript - the last one
		// wins - so this is checked by behaviour, not by reading the source.
		expect(accepts(schemas.annexSchema as ZodType, { address: "a", detached: true })).toBe(true);
		expect(accepts(schemas.annexSchema as ZodType, { address: 1, detached: true })).toBe(false);
	});

	it("inherits the INDEXER, not only the properties", () => {
		/**
		 * `Ledger extends Record<string>`. openapi3 puts `unevaluatedProperties: {type: string}` on the
		 * base and `{not:{}}` on the derived; measured with Ajv 2020-12, the base's annotation wins and
		 * an extra string IS allowed while an extra number is not. A derived validator that read only
		 * its own indexer would seal the model and reject both.
		 */
		expect(accepts(schemas.ledgerSchema as ZodType, { reference: "r", extra: "ok" })).toBe(true);
		expect(accepts(schemas.ledgerSchema as ZodType, { reference: "r", extra: 42 })).toBe(false);
	});
});
