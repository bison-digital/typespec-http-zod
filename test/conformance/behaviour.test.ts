/**
 * **The emitted validator and the document must answer the same question the same way.**
 *
 * Every other axis of the differential compares the two as DESCRIPTIONS: the shape describers read
 * `._zod.def` beside the document's keywords, and `z.toJSONSchema()` is compared against the
 * document with nothing of ours in between. Both can report perfect agreement about a pair that
 * answers differently the moment a value arrives, because a keyword and its SEMANTICS are two facts
 * and only the first is written down.
 *
 * That gap was not hypothetical. On zod 4.4.3 the emitter published `maxLength: 5` and emitted
 * `.max(5)` - the same keyword, the same number, agreeing on every existing axis - and the two
 * disagreed about a five-emoji string in BOTH directions: `.max()` counted UTF-16 units where the
 * document counts code points, so the validator refused a payload the document permits, and `.min()`
 * admitted one the document forbids. Nothing in this repository could see it, because
 * `portability.test.ts` requires ASCII source and so no fixture had ever carried an astral character.
 *
 * **Ajv runs WITHOUT `ajv-formats`**, which is not a convenience: `format` is an annotation under
 * JSON Schema 2020-12 rather than an assertion, and that is this emitter's stated position on an
 * `@format` annotation too. A DECLARED scalar is a different claim and the validator does enforce it,
 * so `probes.ts` generates values that satisfy the document's own `format` and the asymmetry never
 * arises. There is no exception set here, deliberately - a divergence has nowhere to hide.
 *
 * **Both directions are graded and they are not the same failure.** A validator stricter than the
 * document refuses conformant callers; a validator looser than it lets a payload the contract
 * forbids reach a handler. The second is the one a server cannot afford.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
	compileScenario,
	depthSources,
	discoverScenarios,
	openapiDirFor,
	GRADED_OPENAPI_VERSIONS,
} from "./corpus.js";
import { probesFor, type Schema } from "./probes.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const outRoot = join(here, ".out-behaviour");

/** `Property.JsonEncodedNameModel` -> `jsonEncodedNameModelSchema`. Mirrors `differential.test.ts`. */
function identifierFor(component: string): string {
	const bare = component.split(".").at(-1) ?? component;
	return `${bare.charAt(0).toLowerCase()}${bare.slice(1)}Schema`;
}

interface Disagreement {
	readonly scenario: string;
	readonly component: string;
	readonly keyword: string;
	readonly why: string;
	readonly document: boolean;
	readonly validator: boolean;
	/** Whether the document schema carries OpenAPI's `discriminator` annotation. See the arms below. */
	readonly discriminated: boolean;
}

interface Tally {
	readonly disagreements: Disagreement[];
	readonly comparedByKeyword: Record<string, number>;
	componentsProbed: number;
	componentsUnbuildable: number;
	scenariosRead: number;
}

const tally: Tally = {
	disagreements: [],
	comparedByKeyword: {},
	componentsProbed: 0,
	componentsUnbuildable: 0,
	scenariosRead: 0,
};

beforeAll(async () => {
	const sources = [...discoverScenarios(), ...depthSources()];
	for (const scenario of sources) {
		const compiled = await compileScenario(scenario, outRoot);
		if (compiled.failure !== undefined) continue;

		const versionDir = openapiDirFor(compiled.openapiDir, GRADED_OPENAPI_VERSIONS[0]);
		let document: { components?: { schemas?: Record<string, Schema> } };
		let emitted: Record<string, unknown>;
		try {
			const names = (await import("node:fs"))
				.readdirSync(versionDir)
				.filter((f) => f.endsWith(".json"));
			const chosen =
				compiled.latestVersion === undefined
					? names.at(-1)
					: (names.find((n) => n === `openapi.${compiled.latestVersion}.json`) ?? names.at(-1));
			if (chosen === undefined) continue;
			document = JSON.parse(readFileSync(join(versionDir, chosen), "utf8"));
			emitted = (await import(join(compiled.zodDir, "schemas.gen.ts"))) as Record<string, unknown>;
		} catch {
			continue;
		}

		const schemas = document.components?.schemas;
		if (schemas === undefined) continue;
		tally.scenariosRead += 1;

		/**
		 * **`$ref` is resolved by pointing Ajv at a root that CARRIES the components.**
		 *
		 * `#/components/schemas/Foo` is a pointer into the document, so the schema handed to Ajv has
		 * to be a document-shaped root for the pointer to land. `components` is not a JSON Schema
		 * keyword, so it contributes nothing to validation and exists only to be addressed.
		 */
		const ajv = new Ajv2020.default({ strict: false, allErrors: false, validateFormats: false });
		const resolve = (ref: string): Schema | undefined => {
			const name = ref.startsWith("#/components/schemas/") ? ref.slice(21) : undefined;
			return name === undefined ? undefined : schemas[name];
		};

		for (const [component, schema] of Object.entries(schemas)) {
			const validator = emitted[identifierFor(component)];
			if (validator === undefined || typeof (validator as ZodType).safeParse !== "function")
				continue;

			const probes = probesFor(schema, resolve);
			if (probes.length === 0) {
				tally.componentsUnbuildable += 1;
				continue;
			}

			let byDocument: (value: unknown) => boolean;
			try {
				byDocument = ajv.compile({
					$ref: `#/components/schemas/${component}`,
					components: document.components,
				}) as unknown as (value: unknown) => boolean;
			} catch {
				tally.componentsUnbuildable += 1;
				continue;
			}
			tally.componentsProbed += 1;

			for (const probe of probes) {
				const documentSays = byDocument(probe.value);
				const validatorSays = (validator as ZodType).safeParse(probe.value).success;
				tally.comparedByKeyword[probe.keyword] = (tally.comparedByKeyword[probe.keyword] ?? 0) + 1;
				if (documentSays !== validatorSays) {
					tally.disagreements.push({
						scenario: scenario.name,
						component,
						keyword: probe.keyword,
						why: probe.why,
						document: documentSays,
						validator: validatorSays,
						discriminated: "discriminator" in schema,
					});
				}
			}
		}
	}
}, 900_000);

describe("the emitted validator answers as the document does", () => {
	/**
	 * **Floors set just under the measured values, not at a round number well below them.**
	 *
	 * A floor of 4 against an actual of 8 is not a guard, it is a formality: the generator could stop
	 * producing half its probes and this file would stay green while comparing less than it reports.
	 * Measured at the time of writing: 52 scenarios, 211 components probed, 8 length probes per bound.
	 */
	it("read enough of the corpus to be a comparison at all", () => {
		expect(tally.scenariosRead).toBeGreaterThanOrEqual(50);
		expect(tally.componentsProbed).toBeGreaterThanOrEqual(200);
	});

	it("exercised the length keywords, which is where the classes differ", () => {
		expect(tally.comparedByKeyword["maxLength"] ?? 0).toBeGreaterThanOrEqual(8);
		expect(tally.comparedByKeyword["minLength"] ?? 0).toBeGreaterThanOrEqual(8);
		expect(tally.comparedByKeyword["required"] ?? 0).toBeGreaterThanOrEqual(250);
		expect(tally.comparedByKeyword["type"] ?? 0).toBeGreaterThanOrEqual(200);
		expect(tally.comparedByKeyword["additionalProperties"] ?? 0).toBeGreaterThanOrEqual(200);
	});

	/**
	 * **Asserted as a SET, because a count cannot notice a whole class going missing.**
	 *
	 * The numeric and array bounds are thin - `@typespec/http-specs` declares no constraints at all,
	 * so every one of them comes from `test/reference/constraints.tsp`. Thin is not the same as
	 * absent, and the failure worth catching is a keyword class dropping to zero: a change to the
	 * generator, or to the fixture, that quietly stops exercising a rule the emitter can emit.
	 */
	it("exercises every keyword class the emitter can produce", () => {
		const exercised = Object.keys(tally.comparedByKeyword).toSorted();
		expect(
			[
				"additionalProperties",
				"exclusiveMaximum",
				"exclusiveMinimum",
				"maxItems",
				"maxLength",
				"maximum",
				"minItems",
				"minLength",
				"minimum",
				"required",
				"type",
			].filter((keyword) => !exercised.includes(keyword)),
		).toEqual([]);
	});

	/**
	 * **The components this oracle could NOT probe, counted rather than passed over.**
	 *
	 * A probe is a mutation of a value the document accepts, so a component whose minimal instance
	 * cannot be built is simply not graded here - an `allOf` whose members would have to be merged, a
	 * pattern the sampler cannot draw from. That is a real limit and the honest place for it is a
	 * number that may only SHRINK: a change making the generator worse raises it and fails, and one
	 * making it better fails too, which is the prompt to lower the pin and bank the coverage.
	 *
	 * Measured at 75 of 286 components. The keywords those 75 carry are still compared structurally by
	 * `differential.test.ts`; what they lack is a verdict on a value.
	 */
	it("leaves no more components unprobed than it did when this was measured", () => {
		expect(tally.componentsUnbuildable).toBeLessThanOrEqual(75);
	});

	const named = (d: Disagreement) => `${d.scenario} ${d.component}: ${d.why}`;

	it("never ACCEPTS a value the document forbids", () => {
		/**
		 * **The direction a server cannot afford.** A validator looser than the document lets a payload
		 * the contract forbids reach a handler, which is the failure the whole package exists to
		 * prevent. No class is excused here, discriminated or otherwise.
		 */
		const looser = tally.disagreements.filter((d) => !d.document && d.validator);
		expect(looser.map(named)).toEqual([]);
	});

	it("never REFUSES a value the document permits, except where `discriminator` under-specifies", () => {
		const stricter = tally.disagreements.filter((d) => d.document && !d.validator);
		expect(stricter.filter((d) => !d.discriminated).map(named)).toEqual([]);
	});

	/**
	 * **The one asymmetry, and it is the document's rather than the emitter's.**
	 *
	 * A `@discriminator` base publishes as an ordinary object carrying OpenAPI's `discriminator`
	 * annotation, and `discriminator` is not a JSON Schema validation keyword - so Ajv accepts a base
	 * instance whose `kind` names no subtype at all. The emitter emits `z.discriminatedUnion`, which
	 * accepts exactly the declared subtypes. OpenAPI's own prose says the discriminator value must
	 * resolve to a schema, so the validator enforces what the document means and the document under-
	 * states it.
	 *
	 * **Asserted as a CLASS, not a list.** The claim is that this is the ONLY place the two disagree
	 * and that it is always the SAFE direction - stricter, never looser. A disagreement anywhere else
	 * fails the arm above; one in the unsafe direction fails here. Floored, so the class cannot quietly
	 * become vacuous and leave both arms passing about nothing.
	 */
	it("every remaining disagreement is a discriminated base, and is STRICTER rather than looser", () => {
		const discriminated = tally.disagreements.filter((d) => d.discriminated);
		expect(discriminated.length).toBeGreaterThanOrEqual(1);
		expect(discriminated.filter((d) => !d.document || d.validator).map(named)).toEqual([]);
	});
});
