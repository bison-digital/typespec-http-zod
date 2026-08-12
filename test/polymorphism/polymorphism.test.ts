import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A `@discriminator` base validates as the subtype the discriminator names.**
 *
 * The document publishes such a base with `discriminator: {propertyName, mapping}`, and the mapping
 * is an instruction: validate the body against the subtype it names. Emitting the base's own
 * properties instead produced `z.object({kind: z.string(), wingspan})` — which accepts
 * `{kind: "eagle", wingspan: 1}` and checks nothing `Eagle` declares. The endpoint is polymorphic
 * and none of its polymorphism is validated.
 *
 * ⚠️ **The subtypes had no validators at all**, because nothing walked `derivedModels`, and the
 * differential could not see it: it compared a discriminated base as an *object*, and both artefacts
 * stop being objects there. It is compared as a choice now, and `shape.test.ts` pins the describers.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const accepts = (schema: ZodType, value: unknown): boolean => schema.safeParse(value).success;

describe("a discriminated base is a choice between its subtypes", () => {
	let schemas: Record<string, ZodType>;
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "zoo");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	});

	it("compiles without an error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("declares every subtype, not only the models an operation names", () => {
		// `Sparrow`, `Eagle`, `SawShark`… appear in no operation signature. openapi3 publishes a
		// component for each because the discriminator maps to them, and so must this.
		const expected = [
			"birdSchema",
			"sparrowSchema",
			"eagleSchema",
			"fishSchema",
			"sharkSchema",
			"sawSharkSchema",
			"goblinSharkSchema",
			"salmonSchema",
			"reptileSchema",
		];
		expect(expected.filter((identifier) => schemas[identifier] === undefined)).toEqual([]);
	});

	it("validates the body as the subtype the discriminator names", () => {
		// `wingspan` is inherited and required; a base emitted as its own shape would accept the first
		// of these and reject nothing.
		expect(accepts(schemas.birdSchema as ZodType, { kind: "sparrow", wingspan: 12 })).toBe(true);
		expect(accepts(schemas.birdSchema as ZodType, { kind: "sparrow" })).toBe(false);
	});

	it("REJECTS a discriminator value no subtype claims", () => {
		// The arm that fails if the base is still emitted as `z.object({kind: z.string(), …})`.
		expect(accepts(schemas.birdSchema as ZodType, { kind: "penguin", wingspan: 12 })).toBe(false);
	});

	it("keeps each subtype sealed against what nobody declared", () => {
		expect(accepts(schemas.birdSchema as ZodType, { kind: "sparrow", wingspan: 1, x: 1 })).toBe(
			false,
		);
	});

	it("closes a cycle from a subtype back to the union it belongs to", () => {
		/**
		 * `Eagle.friends?: Bird[]`, where `Bird` is the union `Eagle` is an option of. Measured on Zod
		 * 4.4.3, `z.discriminatedUnion` reads only the discriminator from each option rather than
		 * enumerating its shape — which is the single fact that lets polymorphism and recursion coexist
		 * here. If that ever changes, this arm throws at import rather than failing quietly.
		 */
		expect(
			accepts(schemas.birdSchema as ZodType, {
				kind: "eagle",
				wingspan: 2,
				friends: [{ kind: "sparrow", wingspan: 1 }],
				partner: { kind: "eagle", wingspan: 3 },
			}),
		).toBe(true);
		// And the recursion is really checked, rather than degrading to `unknown`.
		expect(
			accepts(schemas.birdSchema as ZodType, {
				kind: "eagle",
				wingspan: 2,
				friends: [{ kind: "penguin", wingspan: 1 }],
			}),
		).toBe(false);
	});

	it("switches again at the second level", () => {
		// `Fish` switches on `kind`; its `Shark` option switches on `sharktype`. A single-level union
		// would accept any `sharktype` at all.
		expect(accepts(schemas.fishSchema as ZodType, { kind: "salmon", age: 1 })).toBe(true);
		expect(
			accepts(schemas.fishSchema as ZodType, { kind: "shark", age: 1, sharktype: "saw" }),
		).toBe(true);
		expect(
			accepts(schemas.fishSchema as ZodType, { kind: "shark", age: 1, sharktype: "hammerhead" }),
		).toBe(false);
	});

	it("leaves a discriminator with no subtypes as an ORDINARY object", () => {
		// A union over zero options validates nothing, and openapi3 emits no mapping for this case.
		expect(accepts(schemas.reptileSchema as ZodType, { kind: "anything", scales: 4 })).toBe(true);
		expect(accepts(schemas.reptileSchema as ZodType, { kind: "anything" })).toBe(false);
	});
});
