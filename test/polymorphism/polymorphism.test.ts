import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A `@discriminator` base validates as the document's base, and hands back the subtype a valid
 * instance of one names.**
 *
 * The document publishes such a base as an object of its own properties beside `discriminator:
 * {propertyName, mapping}`, and each subtype as `allOf` the base. OAS 3.1.1 section 4.8.25: the
 * discriminator "MUST NOT change the validation outcome of the schema", and in this `allOf` form
 * validating the parent "does not perform a search for child schemas or use them in validation in
 * any way". So **every verdict below is graded by Ajv against the document**, a value naming a
 * subtype included. What the discriminator does decide is what comes back: a value that is a valid
 * instance of the subtype its discriminator names is that subtype, with its own properties, as an
 * SDK deserializing the same body would; any other value is the base.
 *
 * **The subtypes had no validators at all once**, because nothing walked `derivedModels`, and the
 * differential could not see it: it compared a discriminated base as an *object*, and both artefacts
 * stop being objects there. It is compared as a choice now, and `shape.test.ts` pins the describers.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a discriminated base", () => {
	let schemas: Record<string, ZodType>;
	let compiled: CompiledFixture;
	let byDocument: (component: string, value: unknown) => boolean;

	beforeAll(async () => {
		compiled = await compileFixture(here, "zoo");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
		const [record] = await getOpenAPI3(compiled.program, {
			"openapi-versions": ["3.1.0"],
			// As the fixture was compiled: an unsealed document graded against a sealed validator
			// hides any disagreement about which properties may exist.
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
	});

	/** The validator's verdict, which must be the document's. */
	const graded = (identifier: string, component: string, value: unknown): boolean => {
		const verdict = (schemas[identifier] as ZodType).safeParse(value).success;
		expect(verdict, `${component} ${JSON.stringify(value)}`).toBe(byDocument(component, value));
		return verdict;
	};
	const parsed = (identifier: string, value: unknown): unknown =>
		(schemas[identifier] as ZodType).parse(value);

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

	it("answers every value as the document's base does, whatever its discriminator names", () => {
		const verdicts = [
			graded("birdSchema", "Bird", { kind: "sparrow", wingspan: 12 }),
			graded("birdSchema", "Bird", { kind: "penguin", wingspan: 12 }),
			graded("birdSchema", "Bird", { kind: "sparrow", wingspan: 1, x: 1 }),
			graded("birdSchema", "Bird", { kind: "sparrow" }),
			graded("birdSchema", "Bird", { kind: "penguin" }),
			graded("birdSchema", "Bird", { wingspan: 12 }),
			graded("fishSchema", "Fish", { kind: "shark", age: 1, sharktype: "hammerhead" }),
			graded("fishSchema", "Fish", { kind: "shark", age: 1 }),
			graded("fishSchema", "Fish", { kind: "trout", age: 1 }),
			graded("sharkSchema", "Shark", { kind: "shark", age: 1, sharktype: "hammerhead" }),
			graded("sharkSchema", "Shark", { kind: "shark", age: 1 }),
			graded("snakeSchema", "Snake", { kind: "cobra", length: 1 }),
			graded("snakeSchema", "Snake", { kind: "wrongKind", length: 1 }),
			graded("petSchema", "Pet", { kind: "dog", name: "d" }),
			graded("petSchema", "Pet", { kind: "cat", name: "c" }),
			graded("petSchema", "Pet", { kind: "parrot", name: "p" }),
		];
		// Not vacuous: the document accepts some and refuses others.
		expect(verdicts).toContain(true);
		expect(verdicts).toContain(false);
	});

	it("refuses through the base's own discriminator a value outside a closed one", () => {
		expect(graded("snakeSchema", "Snake", { kind: "wrongKind", length: 1 })).toBe(false);
		expect(graded("petSchema", "Pet", { kind: "parrot", name: "p" })).toBe(false);
	});

	it("hands back a valid instance of the subtype its discriminator names as that subtype", () => {
		// `Dog` adds `barks`, which a `Pet` would not carry: it comes back because the value is a `Dog`.
		expect(parsed("petSchema", { kind: "dog", name: "d", barks: true })).toEqual({
			kind: "dog",
			name: "d",
			barks: true,
		});
		expect(parsed("fishSchema", { kind: "shark", age: 1, sharktype: "saw" })).toEqual({
			kind: "shark",
			age: 1,
			sharktype: "saw",
		});
	});

	it("hands back the base for a value no subtype accepts", () => {
		// `Sparrow` is sealed, so `x` makes this no `Sparrow`; the document accepts it as a `Bird`,
		// which does not declare `x`.
		expect(parsed("birdSchema", { kind: "sparrow", wingspan: 1, x: 1 })).toEqual({
			kind: "sparrow",
			wingspan: 1,
		});
		expect(parsed("petSchema", { kind: "dog", name: "d" })).toEqual({ kind: "dog", name: "d" });
	});

	it("closes a cycle from a subtype back to the union it belongs to", () => {
		/**
		 * `Eagle.friends?: Bird[]`, where `Bird` is the union `Eagle` is an option of. Measured on Zod
		 * 4.4.3, `z.discriminatedUnion` reads only the discriminator from each option rather than
		 * enumerating its shape - which is the single fact that lets polymorphism and recursion coexist
		 * here. If that ever changes, this arm throws at import rather than failing quietly.
		 */
		const eagle = {
			kind: "eagle",
			wingspan: 2,
			friends: [
				{ kind: "sparrow", wingspan: 1 },
				{ kind: "penguin", wingspan: 1 },
			],
			partner: { kind: "eagle", wingspan: 3 },
		};
		expect(graded("birdSchema", "Bird", eagle)).toBe(true);
		// A valid `Eagle`, so it comes back as one, its friends checked as `Bird`s.
		expect(parsed("birdSchema", eagle)).toEqual(eagle);
		expect(
			(schemas["eagleSchema"] as ZodType).safeParse({ ...eagle, friends: [{ kind: "penguin" }] })
				.success,
		).toBe(false);
	});

	it("leaves a discriminator with no subtypes as an ORDINARY object", () => {
		// A union over zero options validates nothing, and openapi3 emits no mapping for this case.
		expect(graded("reptileSchema", "Reptile", { kind: "anything", scales: 4 })).toBe(true);
		expect(graded("reptileSchema", "Reptile", { kind: "anything" })).toBe(false);
	});
});
