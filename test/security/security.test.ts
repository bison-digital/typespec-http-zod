import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";
import {
	getAllHttpServices,
	getAuthenticationForOperation,
	type HttpOperation,
} from "@typespec/http";
import type { Program } from "@typespec/compiler";
import { beforeAll, describe, expect, it } from "vitest";
import { collectRoutes, type EmittedRoute } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";

/**
 * **`security` completes what `scopes` and `noAuth` could only approximate.**
 *
 * Both were derived by their own read of `getAuthenticationForOperation`, and both discard the
 * scheme: `@useAuth(BearerAuth)` publishes `security: [{ "BearerAuth": [] }]` in the document and
 * arrived here as an empty scope list, indistinguishable from no authentication at all. Two server
 * emitters had each re-read the program and rebuilt the requirements by hand as a result.
 *
 * `scopes` is now derived from `security` rather than separately read, which is a change to a
 * PUBLISHED field. The arm below is what makes that safe: it recomputes `scopes` the old way,
 * **written out literally here rather than imported from `src/`**, and requires the two to agree
 * across every authentication scenario the corpus declares.
 */

const specs = fileURLToPath(
	new URL("../../node_modules/@typespec/http-specs/specs/", import.meta.url),
);

/** The scenarios that declare authentication, one per scheme kind the compiler can resolve. */
const SCENARIOS = [
	"authentication/api-key",
	"authentication/oauth2",
	"authentication/union",
	"authentication/noauth/union",
	"authentication/http/custom",
];

/** The rule as it stood before `security` existed. Written out, never imported. */
function scopesTheOldWay(program: Program, operation: HttpOperation): string[] {
	return [
		...new Set(
			(getAuthenticationForOperation(program, operation.operation)?.options ?? []).flatMap(
				(option) =>
					option.schemes.flatMap((scheme) =>
						scheme.type === "oauth2"
							? scheme.flows.flatMap((flow) => flow.scopes.map((scope) => scope.value))
							: [],
					),
			),
		),
	];
}

interface Row {
	readonly scenario: string;
	readonly route: EmittedRoute;
	readonly operation: HttpOperation;
	readonly program: Program;
}

let rows: Row[] = [];

beforeAll(async () => {
	const collected: Row[] = [];
	for (const scenario of SCENARIOS) {
		const program = await compile(NodeHost, join(specs, scenario, "main.tsp"), { noEmit: true });
		const [services] = getAllHttpServices(program);
		for (const service of services) {
			const routes = collectRoutes(program, new SchemaRegistry(program), service);
			for (const route of routes) {
				const operation = service.operations.find(
					(candidate) =>
						candidate.verb.toLowerCase() === route.verb.toLowerCase() &&
						candidate.path === route.path,
				);
				if (operation !== undefined) {
					collected.push({ scenario, route, operation, program });
				}
			}
		}
	}
	rows = collected;
}, 900_000);

describe("the corpus exercises authentication at all", () => {
	it("collected operations from every scenario", () => {
		expect(rows.length).toBeGreaterThanOrEqual(8);
		expect(new Set(rows.map((row) => row.scenario)).size).toBe(SCENARIOS.length);
	});

	/**
	 * **Non-vacuity, and it is the whole file.** If every operation resolved to no requirements, every
	 * comparison below would be `[] === []` and would hold under any implementation.
	 */
	it("covers a scheme with scopes, a scheme without, and an anonymous option", () => {
		expect(
			rows.some((row) => row.route.scopes.length > 0),
			"a scheme with scopes",
		).toBe(true);
		expect(
			rows.some((row) =>
				row.route.security.some((requirement) =>
					Object.values(requirement).some((scopes) => scopes.length === 0),
				),
			),
			"a scheme with no scopes",
		).toBe(true);
		expect(
			rows.some((row) => row.route.noAuth),
			"an anonymous option",
		).toBe(true);
		expect(
			rows.some((row) => row.route.security.length > 0),
			"a real requirement",
		).toBe(true);
	});
});

describe("scopes still means exactly what it meant", () => {
	it("agrees with the old derivation on every operation", () => {
		const disagreements: string[] = [];
		for (const row of rows) {
			const before = scopesTheOldWay(row.program, row.operation).toSorted();
			const after = [...row.route.scopes].toSorted();
			if (JSON.stringify(before) !== JSON.stringify(after)) {
				disagreements.push(
					`${row.scenario} ${row.route.operationId}: was ${JSON.stringify(before)}, ` +
						`now ${JSON.stringify(after)}`,
				);
			}
		}
		expect(disagreements).toEqual([]);
	});
});

describe("security carries what the projections discard", () => {
	it("names the scheme, which a flat scope list cannot", () => {
		const named = rows.flatMap((row) => row.route.security.flatMap((r) => Object.keys(r)));
		expect(named.length).toBeGreaterThanOrEqual(4);
		// A bearer or api-key scheme has no scopes, so `scopes` alone said nothing about it at all.
		const scopeless = rows.filter(
			(row) => row.route.scopes.length === 0 && row.route.security.length > 0,
		);
		expect(scopeless.length).toBeGreaterThanOrEqual(1);
	});

	it("drops an option that demands nothing, rather than publishing NoAuth as a scheme", () => {
		for (const row of rows) {
			for (const requirement of row.route.security) {
				expect(Object.keys(requirement)).not.toContain("noAuth");
				expect(Object.keys(requirement).length).toBeGreaterThanOrEqual(1);
			}
		}
	});

	it("every scope in the flat list is demanded by some requirement", () => {
		for (const row of rows) {
			const fromRequirements = new Set(row.route.security.flatMap((r) => Object.values(r).flat()));
			for (const scope of row.route.scopes) {
				expect(fromRequirements.has(scope), `${row.route.operationId}: ${scope}`).toBe(true);
			}
		}
	});
});
