import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	describeDocumentObject,
	describeZodObject,
	type JsonSchema,
} from "../conformance/shape.js";
import {
	discoverReferenceApis,
	operationsOf,
	roundTrip,
	type OpenApi3Document,
} from "./roundtrip.js";

/**
 * **Can this emitter serve an API nobody here designed?**
 *
 * Every other suite in this package measures the emitter against material that already knows about
 * it — `service.tsp` and `constraints.tsp` are its own fixtures, and even `@typespec/http-specs`,
 * independent as it is, is a corpus of scenarios built to exercise emitters. None of them answers the
 * question a first adopter asks.
 *
 * These are published documents — the OpenAPI Initiative's teaching example and the Swagger
 * Petstore — converted to TypeSpec by `tsp-openapi3` and compiled back out. The assertion is that
 * the operations survive the loop: an API that goes in with N operations comes out with the same N,
 * and this emitter mounts every one of them.
 *
 * ⚠️ **Operation identity, not counts.** Comparing `3` against `3` passes while a path is renamed
 * and another appears. The arms compare the `METHOD /path` sets, so a swap is a failure rather than
 * a wash.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const baselinePath = join(here, "baseline.json");

interface Outcome {
	readonly name: string;
	/** The diagnostic code, when the round trip could not be completed. */
	readonly failure?: string;
	readonly declared: readonly string[];
	readonly afterRoundTrip: readonly string[];
	readonly mounted: number;
	readonly objectsCompared: number;
	readonly shapeDisagreements: readonly string[];
}

interface Baseline {
	readonly counts: {
		readonly documents: number;
		readonly operations: number;
		readonly objectsCompared: number;
	};
	readonly note: string;
	/** Documents this emitter cannot round-trip, each naming the diagnostic that stops it. */
	readonly blocked: Readonly<Record<string, string>>;
	/** `METHOD /path` entries lost in the loop, per document. */
	readonly lostOperations: Readonly<Record<string, readonly string[]>>;
	/** Components where the validator and the round-tripped document disagree. */
	readonly shapeDisagreements: Readonly<Record<string, readonly string[]>>;
}

let outcomes: Outcome[];
let baseline: Baseline;

beforeAll(async () => {
	outcomes = [];
	for (const api of discoverReferenceApis()) {
		const declared = operationsOf(api.original);
		const compiled = await roundTrip(api);
		if (compiled.failure !== undefined) {
			outcomes.push({
				name: api.name,
				failure: compiled.failure.code,
				declared,
				afterRoundTrip: [],
				mounted: 0,
				objectsCompared: 0,
				shapeDisagreements: [],
			});
			continue;
		}
		const file = readdirSync(compiled.openapiDir).find(
			(name) => name.startsWith("openapi") && name.endsWith(".json"),
		);
		const emitted = JSON.parse(
			readFileSync(join(compiled.openapiDir, file ?? ""), "utf8"),
		) as OpenApi3Document & { components?: { schemas?: Record<string, JsonSchema> } };
		const schemas = (await import(join(compiled.zodDir, "schemas.gen.ts"))) as Record<
			string,
			unknown
		>;
		/**
		 * ⚠️ **This counted rows in a route TABLE that no longer exists**, and the table was never the
		 * artefact anybody ran. Every operation gets a `<operationId>Responses` const, unconditionally,
		 * because every operation declares at least its success status — so counting them asks the same
		 * question of the artefact a consumer actually loads.
		 */
		const emittedOperations = Object.keys(schemas).filter((name) =>
			name.endsWith("Responses"),
		).length;

		// The same openness/shape question the conformance differential asks, now against a document
		// derived from somebody else's API rather than from a spec written next to this emitter.
		const disagreements: string[] = [];
		let objectsCompared = 0;
		for (const [component, json] of Object.entries(emitted.components?.schemas ?? {})) {
			const bare = component.split(".").at(-1) ?? component;
			const fromZod = describeZodObject(
				schemas[`${bare.charAt(0).toLowerCase()}${bare.slice(1)}Schema`],
			);
			const fromDocument = describeDocumentObject(json);
			if (fromDocument === undefined || fromZod === undefined) continue;
			objectsCompared++;
			if (fromDocument.openness !== fromZod.openness) {
				disagreements.push(
					`${component}: openness document=${fromDocument.openness} validator=${fromZod.openness}`,
				);
			}
			const documentNames = Object.keys(fromDocument.properties).toSorted().join(",");
			const zodNames = Object.keys(fromZod.properties).toSorted().join(",");
			if (documentNames !== zodNames) {
				disagreements.push(
					`${component}: names document=[${documentNames}] validator=[${zodNames}]`,
				);
			}
		}

		outcomes.push({
			name: api.name,
			declared,
			afterRoundTrip: operationsOf(emitted),
			mounted: emittedOperations,
			objectsCompared,
			shapeDisagreements: disagreements.toSorted(),
		});
	}

	if (process.env.UPDATE_REFERENCE_BASELINE === "1") {
		writeFileSync(
			baselinePath,
			`${JSON.stringify(
				{
					note: "Generated by UPDATE_REFERENCE_BASELINE=1. Failure lists may only SHRINK; the counts may only GROW — see roundtrip.test.ts.",
					/**
					 * ⚠️ **How much this loop actually looked at.** The failure lists below are empty, and
					 * an empty list is the same shape whether the round trip is clean or whether both
					 * documents were silently skipped. These counts are what tells those apart, and the
					 * arms assert them rather than a bare `>= 1`.
					 */
					counts: {
						documents: outcomes.filter((o) => o.failure === undefined).length,
						operations: outcomes.reduce((total, o) => total + o.afterRoundTrip.length, 0),
						objectsCompared: outcomes.reduce((total, o) => total + o.objectsCompared, 0),
					},
					blocked: Object.fromEntries(
						outcomes
							.filter((outcome) => outcome.failure !== undefined)
							.map((outcome) => [outcome.name, outcome.failure ?? ""]),
					),
					lostOperations: Object.fromEntries(
						outcomes
							.filter((o) => o.failure === undefined)
							.map((o) => [o.name, o.declared.filter((op) => !o.afterRoundTrip.includes(op))])
							.filter(([, lost]) => (lost as string[]).length > 0),
					),
					shapeDisagreements: Object.fromEntries(
						outcomes
							.filter((o) => o.shapeDisagreements.length > 0)
							.map((o) => [o.name, o.shapeDisagreements]),
					),
				} satisfies Baseline,
				null,
				"\t",
			)}\n`,
		);
	}
	baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
}, 600_000);

describe("a published API survives the round trip", () => {
	it("has reference documents to work from", () => {
		// Without this the file passes vacuously the day the vendored documents move or stop parsing.
		expect(discoverReferenceApis().length).toBeGreaterThanOrEqual(2);
		expect(outcomes.length).toBe(discoverReferenceApis().length);
		expect(outcomes.some((outcome) => outcome.declared.length >= 3)).toBe(true);
	});

	it("round-trips every document the baseline does not excuse", () => {
		const blocked = Object.fromEntries(
			outcomes
				.filter((outcome) => outcome.failure !== undefined)
				.map((outcome) => [outcome.name, outcome.failure ?? ""]),
		);
		expect(blocked).toEqual(baseline.blocked);
	});

	it("keeps every operation the original declared", () => {
		for (const outcome of outcomes) {
			if (outcome.failure !== undefined) continue;
			const lost = outcome.declared.filter((op) => !outcome.afterRoundTrip.includes(op));
			expect({ [outcome.name]: lost }).toEqual({
				[outcome.name]: baseline.lostOperations[outcome.name] ?? [],
			});
		}
	});

	it("mounts a route for every operation that survived", () => {
		for (const outcome of outcomes) {
			if (outcome.failure !== undefined) continue;
			// A document nobody here wrote, and every one of its operations reachable.
			expect({ [outcome.name]: outcome.mounted }).toEqual({
				[outcome.name]: outcome.afterRoundTrip.length,
			});
		}
	});

	it("agrees with the round-tripped document about the shapes it declares", () => {
		for (const outcome of outcomes) {
			if (outcome.failure !== undefined) continue;
			expect({ [outcome.name]: outcome.shapeDisagreements }).toEqual({
				[outcome.name]: baseline.shapeDisagreements[outcome.name] ?? [],
			});
		}
		/**
		 * ⚠️ **Non-vacuity, held to the recorded number rather than to `>= 1`.** The arm above compares
		 * an empty list against an empty list when nothing is being compared, and one object would
		 * satisfy a floor of one while the other document contributes nothing.
		 */
		const compared = outcomes.reduce((total, outcome) => total + outcome.objectsCompared, 0);
		expect(compared).toBeGreaterThanOrEqual(baseline.counts.objectsCompared);
		const operations = outcomes.reduce((total, o) => total + o.afterRoundTrip.length, 0);
		expect(operations).toBeGreaterThanOrEqual(baseline.counts.operations);
		expect(outcomes.filter((o) => o.failure === undefined).length).toBeGreaterThanOrEqual(
			baseline.counts.documents,
		);
	});
});
