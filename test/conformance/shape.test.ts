import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	describeDocumentDiscriminator,
	describeDocumentObject,
	describeZodDiscriminatedUnion,
	describeZodObject,
	isUnresolvable,
	type JsonSchema,
} from "./shape.js";

/**
 * **Unit tests for the oracle's own eyes.**
 *
 * The differential is only as good as the two functions that reduce each artefact to a comparable
 * shape. Nothing else tests them: they are exercised only through the corpus, and a describer that
 * quietly returns nothing makes every arm downstream pass by finding no disagreements to report.
 *
 * **That is not hypothetical - it happened here.** The constraint arm reported zero divergences
 * across 230 properties and was believed. It was extracting **zero constraints from either side**,
 * because the corpus declares almost none: its only `@minValue`/`@maxValue` sit on a `@statusCode`
 * property, which is HTTP metadata and never reaches a body schema. The arm was measuring nothing
 * and saying "agreed". These tests fix the describers in place so their correctness no longer
 * depends on what a corpus happens to contain, and `differential.test.ts` now asserts a floor on how
 * many constraints it actually saw.
 */

describe("describeZodObject reads what the validator will really do", () => {
	it("distinguishes all four states of openness", () => {
		expect(describeZodObject(z.object({ a: z.string() }).strict())?.openness).toBe("sealed");
		expect(describeZodObject(z.object({ a: z.string() }).loose())?.openness).toBe("open");
		expect(describeZodObject(z.object({ a: z.string() }))?.openness).toBe("silent");
		expect(describeZodObject(z.object({ a: z.string() }).catchall(z.number()))?.openness).toBe(
			"typed",
		);
	});

	it("is undefined for anything that is not an object, so non-objects are never compared", () => {
		expect(describeZodObject(z.enum(["a", "b"]))).toBeUndefined();
		expect(describeZodObject(z.record(z.string(), z.string()))).toBeUndefined();
		expect(describeZodObject(z.union([z.string(), z.number()]))).toBeUndefined();
		expect(describeZodObject(undefined)).toBeUndefined();
	});

	it("reads optionality and nullability through the wrappers the emitter puts them in", () => {
		const shape = describeZodObject(
			z.object({
				plain: z.string(),
				optional: z.string().optional(),
				nullable: z.string().nullable(),
				// The emitter's own order: constraints innermost, `.nullable()`, then `.optional()`.
				both: z.string().min(2).nullable().optional(),
			}),
		);
		expect(shape?.properties.plain).toMatchObject({ required: true, nullable: false });
		expect(shape?.properties.optional).toMatchObject({ required: false, nullable: false });
		expect(shape?.properties.nullable).toMatchObject({ required: true, nullable: true });
		expect(shape?.properties.both).toMatchObject({ required: false, nullable: true });
		// The constraint has to survive being read through two wrappers, or the arm silently drops it.
		expect(shape?.properties.both?.constraints).toEqual({ minLength: 2 });
	});

	it("maps every constraint Zod can carry onto its JSON Schema keyword", () => {
		const shape = describeZodObject(
			z.object({
				minText: z.string().min(1),
				maxText: z.string().max(5),
				patterned: z.string().regex(/^a+$/),
				lowerBound: z.number().min(0),
				upperBound: z.number().max(9),
				exclusiveLower: z.number().gt(0),
				exclusiveUpper: z.number().lt(9),
			}),
		);
		expect(shape?.properties.minText?.constraints).toEqual({ minLength: 1 });
		expect(shape?.properties.maxText?.constraints).toEqual({ maxLength: 5 });
		// The regex SOURCE, without the `/` delimiters `String(regexp)` would add - the document has no
		// equivalent of them, and including them reported every pattern as a disagreement. This test
		// asserted the delimited form until the differential caught it on a real spec.
		expect(shape?.properties.patterned?.constraints).toEqual({ pattern: "^a+$" });
		expect(shape?.properties.lowerBound?.constraints).toEqual({ minimum: 0 });
		expect(shape?.properties.upperBound?.constraints).toEqual({ maximum: 9 });
		// `inclusive` is the ONLY thing separating these from the two above; conflating them would
		// report a validator that accepts zero as one that rejects it.
		expect(shape?.properties.exclusiveLower?.constraints).toEqual({ exclusiveMinimum: 0 });
		expect(shape?.properties.exclusiveUpper?.constraints).toEqual({ exclusiveMaximum: 9 });
	});

	it("tells a length bound on a string from one on an array", () => {
		// Zod spells both `min_length`; JSON Schema calls them `minLength` and `minItems`. A describer
		// that read the check name alone would report agreement between two different keywords.
		const shape = describeZodObject(
			z.object({ text: z.string().min(2), list: z.array(z.string()).min(2).max(3) }),
		);
		expect(shape?.properties.text?.constraints).toEqual({ minLength: 2 });
		expect(shape?.properties.list?.constraints).toEqual({ minItems: 2, maxItems: 3 });
	});

	it("does not report `.int()` as a constraint", () => {
		// It corresponds to `format`, which JSON Schema 2020-12 defines as an annotation rather than an
		// assertion. Reporting it would fail every integer property against a document that asserts
		// nothing.
		expect(describeZodObject(z.object({ n: z.number().int() }))?.properties.n?.constraints).toEqual(
			{},
		);
	});
});

describe("describeDocumentObject reads what the contract really promises", () => {
	const object = (extra: Partial<JsonSchema>): JsonSchema => ({
		type: "object",
		properties: { a: { type: "string" } },
		...extra,
	});

	it("distinguishes all four states of openness", () => {
		expect(describeDocumentObject(object({ unevaluatedProperties: { not: {} } }))?.openness).toBe(
			"sealed",
		);
		expect(describeDocumentObject(object({ unevaluatedProperties: {} }))?.openness).toBe("open");
		expect(describeDocumentObject(object({}))?.openness).toBe("silent");
		expect(
			describeDocumentObject(object({ unevaluatedProperties: { type: "string" } }))?.openness,
		).toBe("typed");
	});

	it("is undefined for a UNION, which is not a plain object", () => {
		// `oneOf`/`anyOf` describe a choice between shapes; there is no single set of properties to
		// compare. `allOf` is a different keyword expressing a different thing - see below.
		expect(describeDocumentObject({ anyOf: [{ type: "string" }] })).toBeUndefined();
		expect(describeDocumentObject(object({ oneOf: [{ type: "string" }] }))).toBeUndefined();
		expect(describeDocumentObject({ type: "string" })).toBeUndefined();
	});

	/**
	 * **This block replaced an assertion that `allOf` was undefined too**, justified in its own
	 * comment as "an inheritance chain... comparing two different things". That reasoning is what hid
	 * 28 of 226 object components from the differential - not as divergences, as absences. The
	 * document seals a derived model with `unevaluatedProperties`, a keyword chosen precisely because
	 * it sees *through* `allOf`, so the inherited properties are part of what the model declares.
	 */
	describe("resolves `allOf`, because that is how the document spells inheritance", () => {
		const resolver = (ref: string): JsonSchema | undefined =>
			({
				"#/components/schemas/Base": {
					type: "object",
					required: ["name"],
					properties: { name: { type: "string" }, note: { type: "string" } },
				},
				"#/components/schemas/Middle": {
					type: "object",
					required: ["mid"],
					properties: { mid: { type: "string" } },
					allOf: [{ $ref: "#/components/schemas/Base" }],
				},
			})[ref];

		it("merges an inherited property in, and keeps its requiredness", () => {
			const shape = describeDocumentObject(
				{
					type: "object",
					required: ["own"],
					properties: { own: { type: "string" } },
					allOf: [{ $ref: "#/components/schemas/Base" }],
					unevaluatedProperties: { not: {} },
				},
				resolver,
			);
			expect(Object.keys(shape?.properties ?? {}).toSorted()).toEqual(["name", "note", "own"]);
			expect(shape?.properties.name?.required).toBe(true);
			expect(shape?.properties.note?.required).toBe(false);
			// The derived model's own seal still decides openness - inheritance does not open it up.
			expect(shape?.openness).toBe("sealed");
		});

		it("follows a chain more than one level deep", () => {
			const shape = describeDocumentObject(
				{ type: "object", properties: {}, allOf: [{ $ref: "#/components/schemas/Middle" }] },
				resolver,
			);
			expect(Object.keys(shape?.properties ?? {}).toSorted()).toEqual(["mid", "name", "note"]);
		});

		it("lets the DERIVED model's own declaration win over the one it inherits", () => {
			const shape = describeDocumentObject(
				{
					type: "object",
					required: ["name"],
					properties: { name: { type: "string", minLength: 3 } },
					allOf: [{ $ref: "#/components/schemas/Base" }],
				},
				resolver,
			);
			expect(shape?.properties.name?.constraints).toEqual({ minLength: 3 });
		});

		it("describes a model that has NOTHING but a base", () => {
			// `properties` is absent here, which the old guard read as "not an object" and dropped.
			const shape = describeDocumentObject(
				{ type: "object", allOf: [{ $ref: "#/components/schemas/Base" }] },
				resolver,
			);
			expect(Object.keys(shape?.properties ?? {}).toSorted()).toEqual(["name", "note"]);
		});

		it("survives a base it cannot resolve rather than inventing one", () => {
			const shape = describeDocumentObject(
				{ type: "object", properties: { own: { type: "string" } }, allOf: [{ $ref: "#/nope" }] },
				resolver,
			);
			expect(Object.keys(shape?.properties ?? {})).toEqual(["own"]);
		});
	});

	it("reads `required` as a list, not as a property flag", () => {
		const shape = describeDocumentObject({
			type: "object",
			required: ["there"],
			properties: { there: { type: "string" }, absent: { type: "string" } },
		});
		expect(shape?.properties.there?.required).toBe(true);
		expect(shape?.properties.absent?.required).toBe(false);
	});

	it("reads nullability in BOTH spellings 3.1 uses", () => {
		// `string | null` arrives as a type array; a union of a `$ref` and null arrives as an `anyOf`.
		// Reading only one spelling reports a disagreement that is not one.
		const shape = describeDocumentObject({
			type: "object",
			properties: {
				viaTypeArray: { type: ["string", "null"] },
				viaAnyOf: { anyOf: [{ $ref: "#/components/schemas/X" }, { type: "null" }] },
				plain: { type: "string" },
			},
		});
		expect(shape?.properties.viaTypeArray?.nullable).toBe(true);
		expect(shape?.properties.viaAnyOf?.nullable).toBe(true);
		expect(shape?.properties.plain?.nullable).toBe(false);
	});

	it("collects every constraint keyword the differential compares", () => {
		const shape = describeDocumentObject({
			type: "object",
			properties: {
				everything: {
					type: "string",
					minLength: 1,
					maxLength: 5,
					pattern: "^a+$",
					minimum: 0,
					maximum: 9,
					exclusiveMinimum: 1,
					exclusiveMaximum: 8,
					minItems: 2,
					maxItems: 3,
					// Deliberately ignored - an annotation, not an assertion.
					format: "int32",
				},
			},
		});
		expect(shape?.properties.everything?.constraints).toEqual({
			minLength: 1,
			maxLength: 5,
			pattern: "^a+$",
			minimum: 0,
			maximum: 9,
			exclusiveMinimum: 1,
			exclusiveMaximum: 8,
			minItems: 2,
			maxItems: 3,
		});
	});

	it("reads a property's constraints THROUGH the scalar it references", () => {
		// A named scalar is where TypeSpec puts a reusable `@pattern`, and the emitter inlines it at
		// every use. Reading only what is written on the property compares our inlined copy against
		// nothing - which left the arm seeing 2 constraints in total and calling it agreement.
		const trimmed: JsonSchema = { type: "string", pattern: "^\\S+$" };
		const resolve = (ref: string): JsonSchema | undefined =>
			ref === "#/components/schemas/Trimmed" ? trimmed : undefined;
		const shape = describeDocumentObject(
			{
				type: "object",
				properties: {
					viaScalar: { $ref: "#/components/schemas/Trimmed" },
					// The property's own constraint wins over the one it inherits.
					narrowed: { $ref: "#/components/schemas/Trimmed", minLength: 3 },
				},
			},
			resolve,
		);
		expect(shape?.properties.viaScalar?.constraints).toEqual({ pattern: "^\\S+$" });
		expect(shape?.properties.narrowed?.constraints).toEqual({ pattern: "^\\S+$", minLength: 3 });
	});

	it("counts a reference it cannot follow as unread rather than as agreement", () => {
		const none = (): undefined => undefined;
		expect(isUnresolvable({ $ref: "#/components/schemas/Missing" }, none)).toBe(true);
		expect(isUnresolvable({ type: "string", minLength: 1 }, none)).toBe(false);
	});
});

describe("describes a POLYMORPHIC component as a choice, not as a shape", () => {
	const cat = z.strictObject({ kind: z.literal("cat"), meows: z.boolean() });
	const dog = z.strictObject({ kind: z.literal("dog"), barks: z.boolean() });

	it("reads the discriminator property and every value it may take", () => {
		const shape = describeZodDiscriminatedUnion(z.discriminatedUnion("kind", [cat, dog]));
		expect(shape).toEqual({ discriminator: "kind", values: ["cat", "dog"] });
	});

	it("looks THROUGH a nested union, which is how multi-level discriminators arrive", () => {
		// `Fish` switches on `kind`; its `Shark` option switches on `sharktype`, and both of THAT
		// union's options say `kind: "shark"`. Reading one level deep would report `[salmon]`.
		const saw = z.strictObject({ kind: z.literal("shark"), sharktype: z.literal("saw") });
		const goblin = z.strictObject({ kind: z.literal("shark"), sharktype: z.literal("goblin") });
		const shark = z.discriminatedUnion("sharktype", [saw, goblin]);
		const salmon = z.strictObject({ kind: z.literal("salmon") });
		const fish = z.discriminatedUnion("kind", [shark, salmon]);
		expect(describeZodDiscriminatedUnion(fish)).toEqual({
			discriminator: "kind",
			values: ["salmon", "shark"],
		});
	});

	it("is undefined for anything that is not a discriminated union", () => {
		expect(describeZodDiscriminatedUnion(cat)).toBeUndefined();
		expect(describeZodDiscriminatedUnion(z.union([z.string(), z.number()]))).toBeUndefined();
		expect(describeZodDiscriminatedUnion(z.string())).toBeUndefined();
	});

	it("reads the document's discriminator from its MAPPING", () => {
		expect(
			describeDocumentDiscriminator({
				type: "object",
				discriminator: { propertyName: "kind", mapping: { dog: "#/x/Dog", cat: "#/x/Cat" } },
			}),
		).toEqual({ discriminator: "kind", values: ["cat", "dog"] });
	});

	it("is undefined for a discriminator that maps NOWHERE, which is still an object", () => {
		// `@discriminator` on a base nobody extends. openapi3 leaves it an ordinary object, and a union
		// over zero options would validate nothing - so both sides must keep treating it as a shape.
		expect(
			describeDocumentDiscriminator({ type: "object", discriminator: { propertyName: "kind" } }),
		).toBeUndefined();
		expect(describeDocumentDiscriminator({ type: "object" })).toBeUndefined();
	});
});

describe("reads what a property IS, and says so only when it can", () => {
	it("names the kind of an ordinary property on both sides", () => {
		const document = describeDocumentObject({
			type: "object",
			properties: { text: { type: "string" }, count: { type: "integer" }, list: { type: "array" } },
		});
		expect(document?.properties.text?.kind).toBe("string");
		// `integer` and `number` are one kind here; Zod spells both `number`.
		expect(document?.properties.count?.kind).toBe("number");
		expect(document?.properties.list?.kind).toBe("array");

		const zod = describeZodObject(
			z.object({ text: z.string(), count: z.number().int(), list: z.array(z.string()) }),
		);
		expect(zod?.properties.text?.kind).toBe("string");
		expect(zod?.properties.count?.kind).toBe("number");
		expect(zod?.properties.list?.kind).toBe("array");
	});

	it("sees through the two wrappers TypeSpec puts around a property", () => {
		const resolve = (ref: string): JsonSchema | undefined =>
			ref === "#/components/schemas/Trimmed" ? { type: "string", pattern: "^\\S+$" } : undefined;
		// A named scalar the emitter inlines...
		expect(
			describeDocumentObject(
				{ type: "object", properties: { a: { $ref: "#/components/schemas/Trimmed" } } },
				resolve,
			)?.properties.a?.kind,
		).toBe("string");
		// ...and a nullable property, which arrives as `anyOf: [T, null]`.
		expect(
			describeDocumentObject({
				type: "object",
				properties: { a: { anyOf: [{ type: "array" }, { type: "null" }] } },
			})?.properties.a?.kind,
		).toBe("array");
	});

	it("leaves the kind ABSENT when neither artefact can name one", () => {
		/**
		 * **Absent must mean unreadable, never "agreed".** The first cut guessed `"unknown"` for
		 * these and reported 17 disagreements that were the describer's own blind spots - a real union
		 * has no single JSON Schema type, and an unresolvable `$ref` has none at all.
		 */
		expect(
			describeDocumentObject({
				type: "object",
				properties: { a: { anyOf: [{ type: "string" }, { type: "number" }] } },
			})?.properties.a?.kind,
		).toBeUndefined();
		expect(
			describeDocumentObject(
				{ type: "object", properties: { a: { $ref: "#/nope" } } },
				() => undefined,
			)?.properties.a?.kind,
		).toBeUndefined();
		expect(
			describeZodObject(z.object({ a: z.union([z.string(), z.number()]) }))?.properties.a?.kind,
		).toBeUndefined();
	});

	it("reads an enum as the type of its members", () => {
		expect(describeZodObject(z.object({ a: z.enum(["x", "y"]) }))?.properties.a?.kind).toBe(
			"string",
		);
		expect(describeZodObject(z.object({ a: z.literal(3) }))?.properties.a?.kind).toBe("number");
	});
});

/**
 * **The empty schema is a statement, and both artefacts must say the same word for it.**
 *
 * This is the arm the harness did not have, and its absence was measurable: a validator that
 * OVER-constrains a value the document leaves open was invisible. The document side read `{}` as
 * *unreadable* and skipped; the skip then counted as coverage. Typing binary multipart parts as
 * `z.string()` reddened three behavioural arms and none of this suite.
 *
 * Under-constraining was always caught - document `string` against validator `any` reads on both
 * sides. The blindness was one-directional, which is exactly why nothing noticed it.
 */
describe("an unconstrained value is read as a statement, not as a failure to read", () => {
	const kindOf = (property: JsonSchema, resolve?: (ref: string) => JsonSchema | undefined) =>
		describeDocumentObject({ type: "object", properties: { a: property } }, resolve)?.properties.a
			?.kind;

	it("reads the empty schema as `any` on both sides", () => {
		expect(kindOf({})).toBe("any");
		expect(describeZodObject(z.object({ a: z.unknown() }))?.properties.a?.kind).toBe("any");
		expect(describeZodObject(z.object({ a: z.any() }))?.properties.a?.kind).toBe("any");
	});

	it("so `{}` against a typed validator is a DISAGREEMENT, not a skip", () => {
		// The whole point, stated as an assertion: these two must not be equal.
		expect(kindOf({})).not.toBe(describeZodObject(z.object({ a: z.string() }))?.properties.a?.kind);
	});

	it("treats annotations as annotations - they assert nothing", () => {
		// `contentMediaType` is what openapi3 publishes for an octet-stream body, and `format` is an
		// annotation rather than an assertion under 2020-12. Neither narrows the value.
		expect(kindOf({ description: "anything at all" })).toBe("any");
		expect(kindOf({ contentMediaType: "application/octet-stream" })).toBe("any");
	});

	it("does NOT read a structural keyword as `any`, even with no `type`", () => {
		/**
		 * The mirror-image mistake, and the more dangerous one: reading `{properties: ...}` as "anything
		 * goes" would invent agreement with every validator that exists.
		 *
		 * **These come back UNREADABLE, not `"object"`/`"array"`.** Inferring the type from a
		 * structural keyword would be a new inference this arm has not earned, and openapi3 emits an
		 * explicit `type` alongside them in every case measured - so the conservative answer costs no
		 * coverage. What the arm guarantees is only that none of these reads as {@link ANY}, and that
		 * is asserted directly rather than through a value that could drift.
		 */
		const structural = [
			{ properties: { b: { type: "string" } } },
			{ items: { type: "string" } },
			{ required: ["b"] },
			{ not: {} },
		] satisfies JsonSchema[];
		const read = structural.map((schema) => [JSON.stringify(schema), kindOf(schema)] as const);
		// Asserted as "none of these is `any`" rather than "each of these is undefined": pinning the
		// exact value would fail a later describer that legitimately infers `object` from `properties`,
		// which would be an improvement. The filter names the offending schema when it does fail.
		expect(read.filter(([, kind]) => kind === "any")).toEqual([]);
		// Non-vacuity: an empty list passes the arm above for free.
		expect(read).toHaveLength(4);
	});

	it("keeps unreadable meaning unreadable", () => {
		// Regression guard on the pair that must stay distinct from `any`.
		expect(kindOf({ anyOf: [{ type: "string" }, { type: "number" }] })).toBeUndefined();
		expect(kindOf({ $ref: "#/nope" }, () => undefined)).toBeUndefined();
	});

	it("reads what an unconstrained container HOLDS, on both sides", () => {
		const elementOf = (property: JsonSchema) =>
			describeDocumentObject({ type: "object", properties: { a: property } })?.properties.a
				?.element;
		expect(elementOf({ type: "array", items: {} })).toBe("any");
		expect(describeZodObject(z.object({ a: z.array(z.unknown()) }))?.properties.a?.element).toBe(
			"any",
		);
		// ...and the disagreement it makes visible.
		expect(elementOf({ type: "array", items: {} })).not.toBe(
			describeZodObject(z.object({ a: z.array(z.string()) }))?.properties.a?.element,
		);
	});
});
