/**
 * **The corpus, graded against the OpenAPI 3.0 document `@typespec/openapi3` publishes by default.**
 *
 * `behaviour.test.ts` grades every component against the 3.1 and 3.2 documents, and until 0.32.0
 * nothing graded the 3.0 one - the version openapi3 publishes when a project sets none, and so the one
 * most projects serve. 0.31.0 read a required read-only property as 3.1 does, required in a request,
 * and refused every create body leaving out a server-assigned id, which the 3.0 document accepts:
 * OAS 3.0.4 says such a `required` "will take effect on the response only". No arm could see it.
 *
 * Here the corpus and the depth sources are compiled with openapi3 publishing `3.0.0` alone, as a
 * project configuring nothing does, and the emitter reads that from the same options. The document is
 * read as OAS 3.0.4 says - `test/support/oas30.ts` - and graded twice:
 *
 * - **Every component as a response**, by its own validator, which is what a response is held to.
 * - **Every JSON request body as a request**, by the validator the route applies - `requestSchema`,
 *   which at 3.0 is the request's own reading where it differs, `WidgetCreate` beside `Widget`.
 *
 * Both directions count: a validator stricter than the document refuses a conformant caller, which is
 * what 0.31.0 shipped, and a looser one lets through what the contract forbids. A scenario the emitter
 * refuses at 3.0 - a `null` the document cannot say - is named below, not graded.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listServices } from "@typespec/compiler";
import { getHttpService } from "@typespec/http";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { collectRoutes } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import { componentsAt30 } from "../support/oas30.js";
import { compileScenario, depthSources, discoverScenarios } from "./corpus.js";
import { probesFor, type Schema } from "./probes.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const outRoot = join(here, ".out-openapi30");

/** `Property.JsonEncodedNameModel` -> `jsonEncodedNameModelSchema`. Mirrors `behaviour.test.ts`. */
function identifierFor(component: string): string {
	const bare = component.split(".").at(-1) ?? component;
	return `${bare.charAt(0).toLowerCase()}${bare.slice(1)}Schema`;
}

interface Disagreement {
	readonly scenario: string;
	readonly at: string;
	readonly keyword: string;
	readonly why: string;
	readonly document: boolean;
	readonly validator: boolean;
}

const tally = {
	scenariosRead: 0,
	componentsProbed: 0,
	componentsCompared: 0,
	requestsCompared: 0,
	disagreements: [] as Disagreement[],
	/** Scenarios this emitter refuses at 3.0, by the diagnostic it raised. */
	refusedHere: [] as string[],
	comparedByKeyword: {} as Record<string, number>,
};

beforeAll(async () => {
	for (const scenario of [...discoverScenarios(), ...depthSources()]) {
		const compiled = await compileScenario(scenario, outRoot, ["3.0.0"]);
		if (compiled.failure !== undefined) {
			if (compiled.failure.owner === "ours") {
				tally.refusedHere.push(`${scenario.name}: ${compiled.failure.code}`);
			}
			continue;
		}
		const program = compiled.program;
		if (program === undefined) continue;
		let document: {
			components?: { schemas?: Record<string, Schema> };
			paths?: Record<string, Record<string, unknown>>;
		};
		let emitted: Record<string, unknown>;
		try {
			const names = readdirSync(compiled.openapiDir).filter((name) => name.endsWith(".json"));
			const chosen =
				compiled.latestVersion === undefined
					? names.at(-1)
					: (names.find((name) => name === `openapi.${compiled.latestVersion}.json`) ??
						names.at(-1));
			if (chosen === undefined) continue;
			document = JSON.parse(readFileSync(join(compiled.openapiDir, chosen), "utf8"));
			emitted = (await import(join(compiled.zodDir, "schemas.gen.ts"))) as Record<string, unknown>;
		} catch {
			continue;
		}
		tally.scenariosRead += 1;

		const asResponse = componentsAt30(document, "response");
		const asRequest = componentsAt30(document, "request");
		const resolve = (ref: string): Schema | undefined =>
			ref.startsWith("#/components/schemas/")
				? (asResponse.schemas[ref.slice(21)] as Schema | undefined)
				: undefined;
		const ajv = new Ajv2020.default({ strict: false, allErrors: false, validateFormats: false });
		const byDocument = (components: object, ref: string) => {
			try {
				return ajv.compile({ $ref: ref, components }) as unknown as (value: unknown) => boolean;
			} catch {
				return undefined;
			}
		};
		const grade = (
			at: string,
			validator: ZodType,
			judge: (value: unknown) => boolean,
			component: string,
		) => {
			let compared = 0;
			for (const probe of probesFor(asResponse.schemas[component] as Schema, resolve)) {
				compared += 1;
				tally.comparedByKeyword[probe.keyword] = (tally.comparedByKeyword[probe.keyword] ?? 0) + 1;
				const documentSays = judge(probe.value);
				const validatorSays = validator.safeParse(probe.value).success;
				if (documentSays !== validatorSays) {
					tally.disagreements.push({
						scenario: scenario.name,
						at,
						keyword: probe.keyword,
						why: probe.why,
						document: documentSays,
						validator: validatorSays,
					});
				}
			}
			return compared;
		};

		for (const component of Object.keys(document.components?.schemas ?? {})) {
			const validator = emitted[identifierFor(component)] as ZodType | undefined;
			if (validator === undefined || typeof validator.safeParse !== "function") continue;
			const judge = byDocument(asResponse, `#/components/schemas/${component}`);
			if (judge === undefined) continue;
			const compared = grade(`component ${component}`, validator, judge, component);
			if (compared > 0) tally.componentsProbed += 1;
			tally.componentsCompared += compared;
		}

		for (const service of listServices(program)) {
			const [http] = getHttpService(program, service.type);
			const routes = collectRoutes(program, new SchemaRegistry(program), http);
			for (const route of routes) {
				if (route.requestSchema === undefined) continue;
				const validator = emitted[route.requestSchema] as ZodType | undefined;
				if (validator === undefined || typeof validator.safeParse !== "function") continue;
				const operation = document.paths?.[route.path]?.[route.verb.toLowerCase()] as
					| { requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> } }
					| undefined;
				const ref = operation?.requestBody?.content?.["application/json"]?.schema?.$ref;
				if (ref === undefined || !ref.startsWith("#/components/schemas/")) continue;
				const judge = byDocument(asRequest, ref);
				if (judge === undefined) continue;
				tally.requestsCompared += grade(
					`request ${route.verb} ${route.path}`,
					validator,
					judge,
					ref.slice(21),
				);
			}
		}
	}
}, 900_000);

describe("the emitted validators answer as the OpenAPI 3.0 document does", () => {
	it("disagree with it about no value, as a response or as a request", () => {
		expect(tally.disagreements).toEqual([]);
	});

	/**
	 * **Floors just under what was measured**: 65 scenarios, 217 components, 1383 component values
	 * and 830 request values, `null` and a required read-only property left out among them. A floor
	 * far below would let the arm stop comparing half of it and stay green.
	 */
	it("read enough of the corpus to be a comparison at all", () => {
		expect(tally.scenariosRead).toBeGreaterThanOrEqual(60);
		expect(tally.componentsProbed).toBeGreaterThanOrEqual(200);
		expect(tally.componentsCompared).toBeGreaterThanOrEqual(1300);
		expect(tally.requestsCompared).toBeGreaterThanOrEqual(700);
		expect(tally.comparedByKeyword["null"] ?? 0).toBeGreaterThanOrEqual(400);
		expect(tally.comparedByKeyword["required"] ?? 0).toBeGreaterThanOrEqual(250);
	});

	/**
	 * **What the emitter refuses here, named.** Two are refused at every version. The other two are
	 * `unpublishable-null`, each measured against the 3.0 document openapi3 writes: `type/array`'s
	 * `nullable-model` publishes its items as `{ type: object, allOf: [InnerModel], nullable: true }`
	 * and `reference/service`'s `retiredOn` as `{ type: string, allOf: [IsoDate], nullable: true }`,
	 * and Ajv refuses `null` for both, where the scenario's `nullable-string` and its sibling scalars
	 * accept it. `type/property/additional-properties` is `unpublishable-record`: its sealed
	 * `ExtendsStringAdditionalProperties extends Record<string>` is published at 3.0 with
	 * `additionalProperties: { not: {} }` beside an `allOf` holding the record, and the document refused
	 * the extra string key the validator, and the 3.1 document, accept - measured before the refusal
	 * existed. A refusal appearing or vanishing changes what a default project can compile.
	 */
	it("refuses only what the 3.0 document cannot state", () => {
		expect(tally.refusedHere.toSorted()).toEqual([
			"reference/service: typespec-http-zod/unpublishable-null",
			"response/status-code-range: typespec-http-zod/unsupported-status-code-range",
			"type/array: typespec-http-zod/unpublishable-null",
			"type/property/additional-properties: typespec-http-zod/unpublishable-record",
			"type/union/discriminated: typespec-http-zod/undeclared-discriminator",
		]);
	});
});
