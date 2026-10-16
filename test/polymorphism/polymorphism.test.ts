import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A `@discriminator` base validates a value naming a subtype as that subtype, and any other value
 * as the base itself.**
 *
 * The document publishes such a base as an object of its own properties carrying `discriminator:
 * {propertyName, mapping}`, and each subtype as `allOf` the base. Emitting the base's own properties
 * alone produced `z.object({kind: z.string(), wingspan})` - which accepts `{kind: "eagle", wingspan:
 * 1}` and checks nothing `Eagle` declares. So the mapping is taken as the hint it is: a value naming
 * `Eagle` is validated as `Eagle`, never looser than the document, since `Eagle` is `allOf` the base.
 *
 * **A value naming no subtype is the document's to decide, and Ajv decides it here.** OAS 3.1.1
 * section 4.8.25: `discriminator` "MUST NOT change the validation outcome of the schema", and in this
 * `allOf` form validating the parent "does not perform a search for child schemas". So such a value is
 * accepted wherever the base's own schema accepts it, and refused by a closed discriminator outside it.
 * This package refused every one of them until typespec-http-graphql's report of 2026-10-16.
 *
 * **The subtypes had no validators at all once**, because nothing walked `derivedModels`, and the
 * differential could not see it: it compared a discriminated base as an *object*, and both artefacts
 * stop being objects there. It is compared as a choice now, and `shape.test.ts` pins the describers.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const accepts = (schema: ZodType, value: unknown): boolean => schema.safeParse(value).success;

describe("a discriminated base is a choice between its subtypes", () => {
	let schemas: Record<string, ZodType>;
	let compiled: CompiledFixture;
	let byDocument: (component: string, value: unknown) => boolean;

	beforeAll(async () => {
		compiled = await compileFixture(here, "zoo");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
		const [record] = await getOpenAPI3(compiled.program, { "openapi-versions": ["3.1.0"] });
		const document = JSON.parse(
			JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
		) as { components: Record<string, unknown> };
		const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
		byDocument = (component, value) =>
			ajv.validate(
				{ $ref: `#/components/schemas/${component}`, components: document.components },
				value,
			);
	});

	/** The validator's verdict, which must be the document's. */
	const graded = (identifier: string, component: string, value: unknown): boolean => {
		const verdict = accepts(schemas[identifier] as ZodType, value);
		expect(verdict, `${component} ${JSON.stringify(value)}`).toBe(byDocument(component, value));
		return verdict;
	};

	it("compiles without an error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("declares every subtype, not only the models an operation names", () => {
		// `Sparrow`, `Eagle`, `SawShark`... appear in no operation signature. openapi3 publishes a
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
			"snakeSchema",
			"cobraSchema",
			"petSchema",
			"dogSchema",
		];
		expect(expected.filter((identifier) => schemas[identifier] === undefined)).toEqual([]);
	});

	it("validates the body as the subtype the discriminator names", () => {
		// `wingspan` is inherited and required; a base emitted as its own shape would accept the first
		// of these and reject nothing.
		expect(accepts(schemas.birdSchema as ZodType, { kind: "sparrow", wingspan: 12 })).toBe(true);
		expect(accepts(schemas.birdSchema as ZodType, { kind: "sparrow" })).toBe(false);
	});

	it("validates a discriminator value no subtype claims as the base, as the document does", () => {
		expect(graded("birdSchema", "Bird", { kind: "penguin", wingspan: 12 })).toBe(true);
		// The base's own requirements still hold.
		expect(graded("birdSchema", "Bird", { kind: "penguin" })).toBe(false);
		expect(graded("birdSchema", "Bird", { wingspan: 12 })).toBe(false);
	});

	it("keeps each subtype sealed: a known kind never falls through to the base", () => {
		/**
		 * The base arm is unsealed, as the document's base is, so it would accept `x` and strip it.
		 * `Sparrow` is sealed and refuses it - and a value naming `sparrow` is `Sparrow`'s to answer,
		 * which the base arm's guarded `kind` keeps it.
		 */
		expect(accepts(schemas.birdSchema as ZodType, { kind: "sparrow", wingspan: 1, x: 1 })).toBe(
			false,
		);
	});

	it("closes a cycle from a subtype back to the union it belongs to", () => {
		/**
		 * `Eagle.friends?: Bird[]`, where `Bird` is the union `Eagle` is an option of. Measured on Zod
		 * 4.4.3, `z.discriminatedUnion` reads only the discriminator from each option rather than
		 * enumerating its shape - which is the single fact that lets polymorphism and recursion coexist
		 * here. If that ever changes, this arm throws at import rather than failing quietly.
		 */
		expect(
			accepts(schemas.birdSchema as ZodType, {
				kind: "eagle",
				wingspan: 2,
				friends: [
					{ kind: "sparrow", wingspan: 1 },
					{ kind: "penguin", wingspan: 1 },
				],
				partner: { kind: "eagle", wingspan: 3 },
			}),
		).toBe(true);
		// And the recursion is really checked, rather than degrading to `unknown`.
		expect(
			accepts(schemas.birdSchema as ZodType, {
				kind: "eagle",
				wingspan: 2,
				friends: [{ kind: "penguin" }],
			}),
		).toBe(false);
	});

	it("switches again at the second level, with a base arm at each", () => {
		// `Fish` switches on `kind`; its `Shark` option switches on `sharktype`.
		expect(accepts(schemas.fishSchema as ZodType, { kind: "salmon", age: 1 })).toBe(true);
		expect(
			accepts(schemas.fishSchema as ZodType, { kind: "shark", age: 1, sharktype: "saw" }),
		).toBe(true);
		// A `sharktype` no subtype claims is a `Shark`; a `kind` none claims is a `Fish`.
		expect(graded("fishSchema", "Fish", { kind: "shark", age: 1, sharktype: "hammerhead" })).toBe(
			true,
		);
		expect(graded("sharkSchema", "Shark", { kind: "shark", age: 1, sharktype: "hammerhead" })).toBe(
			true,
		);
		expect(graded("fishSchema", "Fish", { kind: "trout", age: 1 })).toBe(true);
		expect(graded("sharkSchema", "Shark", { kind: "shark", age: 1 })).toBe(false);
		// And `SawShark`, sealed, still answers for `saw` at the second level.
		expect(
			accepts(schemas.fishSchema as ZodType, { kind: "shark", age: 1, sharktype: "saw", x: 1 }),
		).toBe(false);
	});

	it("refuses through the base's own discriminator a value outside a closed one", () => {
		// Every member of `SnakeKind` is claimed, so there is no base arm; the dispatch is the base.
		expect(graded("snakeSchema", "Snake", { kind: "cobra", length: 1 })).toBe(true);
		expect(graded("snakeSchema", "Snake", { kind: "wrongKind", length: 1 })).toBe(false);
		// `PetKind.Cat` is claimed by nothing, so a cat is the base's; a parrot is in neither.
		expect(graded("petSchema", "Pet", { kind: "cat", name: "c" })).toBe(true);
		expect(graded("petSchema", "Pet", { kind: "parrot", name: "p" })).toBe(false);
		// A dog is `Dog`'s, which requires `barks`.
		expect(accepts(schemas.petSchema as ZodType, { kind: "dog", name: "d" })).toBe(false);
		expect(accepts(schemas.petSchema as ZodType, { kind: "dog", name: "d", barks: true })).toBe(
			true,
		);
	});

	it("leaves a discriminator with no subtypes as an ORDINARY object", () => {
		// A union over zero options validates nothing, and openapi3 emits no mapping for this case.
		expect(accepts(schemas.reptileSchema as ZodType, { kind: "anything", scales: 4 })).toBe(true);
		expect(accepts(schemas.reptileSchema as ZodType, { kind: "anything" })).toBe(false);
	});
});
