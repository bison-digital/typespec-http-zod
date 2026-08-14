import { fileURLToPath } from "node:url";
import { getAllHttpServices } from "@typespec/http";
import { beforeAll, describe, expect, it } from "vitest";
import { collectRoutes } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **`EmittedRoute` carries facts that never appear in an emitted file, and those were graded by
 * nothing.**
 *
 * Every arm in this suite reads what the emitter WROTE. `requestContentTypes` is not written
 * anywhere: it is published on the route record for a server emitter to read, and it decides how an
 * incoming body is parsed. It exists because its absence was two live defects in a generated server -
 * every request body handed to `c.req.json()`, and a `bytes` body read as text and silently corrupted.
 *
 * Measured before this arm existed: truncating `requestContentTypes` to its first entry left all 207
 * tests green. A field added to fix two defects, then graded by nothing.
 *
 * The invariant is the document's own: an operation's body declares a set of media types, and the
 * route record has to carry all of them. `@typespec/http` resolves that set, and it is the same set
 * `@typespec/openapi3` publishes as the `requestBody.content` keys.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a route carries every media type its body declares", () => {
	let compiled: CompiledFixture;
	let routes: ReturnType<typeof collectRoutes>;
	/** operation id -> the media types `@typespec/http` resolved for its body. */
	let declared: Map<string, readonly string[]>;

	beforeAll(async () => {
		compiled = await compileFixture(here, "several");
		const [services] = getAllHttpServices(compiled.program);
		const service = services[0];
		if (service === undefined) throw new Error("fixture declares no service");
		routes = collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service);
		declared = new Map(
			service.operations.map((operation) => [
				operation.operation.name,
				[...(operation.parameters.body?.contentTypes ?? [])],
			]),
		);
	}, 120_000);

	it("compiles, and finds routes to compare", () => {
		expect(compiled.diagnostics).toEqual([]);
		// Non-vacuity: an empty route set would agree with an empty declaration set about nothing.
		expect(routes.length).toBeGreaterThanOrEqual(3);
	});

	it("declares more than one media type somewhere, or the arm proves nothing", () => {
		/**
		 * The whole class only exists where a body offers a choice. A fixture of single-media-type
		 * operations would pass the comparison below while never exercising it, which is exactly how
		 * this went ungraded.
		 */
		const several = [...declared.values()].filter((types) => types.length > 1);
		expect(several.length).toBeGreaterThanOrEqual(1);
	});

	it("carries exactly the media types the operation declares, for every route", () => {
		const disagreements: string[] = [];
		for (const route of routes) {
			const expected = declared.get(route.operationId);
			if (expected === undefined) continue;
			const actual = [...route.requestContentTypes].toSorted().join(", ");
			const wanted = [...expected].toSorted().join(", ");
			if (actual !== wanted) {
				disagreements.push(`${route.operationId}: route=[${actual}] declared=[${wanted}]`);
			}
		}
		expect(disagreements.toSorted()).toEqual([]);
	});

	it("validates the content-type header against every media type it permits", () => {
		/**
		 * The route record and the emitted validator are two artefacts describing one fact, so they have
		 * to agree. A validator accepting fewer types than the route reports refuses a request the
		 * document permits; accepting more admits one it does not.
		 */
		for (const route of routes) {
			if (route.requestContentTypes.length < 2) continue;
			const header = route.headerSchema ?? "";
			for (const type of route.requestContentTypes) {
				expect(header, `${route.operationId} header validator`).toContain(type);
			}
		}
	});
});
