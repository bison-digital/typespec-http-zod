import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHost, compile } from "@typespec/compiler";
import { getAllHttpServices, type HttpOperation } from "@typespec/http";
import { beforeAll, describe, expect, it } from "vitest";
import { collectRoutes } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **`EmittedRoute.reservedPathParameters` against the two things that can contradict it.**
 *
 * A reserved path parameter matches across `/`, which is what lets `GET /vault/areas/health.md`
 * reach one route. The emitter reads `allowReserved` from the resolved parameter. Asserting that by
 * re-reading `allowReserved` would compare the implementation against itself and pass whatever it
 * did, so both arms here derive the same fact from somewhere the emitter never looks:
 *
 * - **`@typespec/http`'s own rendering.** `uriTemplate` keeps the RFC 6570 operator that `path`
 *   strips, and `getUriTemplatePathParam` writes `+` for exactly the parameters that carry the flag.
 *   Tokenised on the template grammar and compared by NAME EQUALITY, never by substring.
 * - **`@typespec/openapi3`'s own detector.** It raises `path-reserved-expansion` once per reserved
 *   parameter, so upstream's count of them is an oracle nothing in this package can influence.
 *
 * The document arm is the other half. The divergence here is deliberate and licensed - OpenAPI
 * cannot express reserved expansion at any version - so this suite pins what the document says
 * INSTEAD, and would notice if that ever stopped being true.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * The names a URI template marks with `+`, read as RFC 6570 expressions rather than searched for.
 *
 * An expression is `{` operator? name (`,` name)* modifier? `}`, and the operator is a single
 * character from a closed set. Splitting on the braces and reading the first character is the
 * grammar's own rule; matching `/\{\+/` against the whole string would find one inside a literal
 * segment just as happily, and this package has six defects on record from deciding by substring.
 */
function reservedNamesInTemplate(uriTemplate: string): string[] {
	const found: string[] = [];
	for (const [, expression] of uriTemplate.matchAll(/\{([^}]*)\}/g)) {
		if (expression === undefined || expression.length === 0) continue;
		const operator = expression[0] ?? "";
		if (operator !== "+") continue;
		for (const name of expression.slice(1).split(",")) {
			// `*` is explode, `:n` is a prefix length. Neither is part of the name.
			found.push(name.replace(/\*$/, "").replace(/:\d+$/, ""));
		}
	}
	return found;
}

describe("a route carries the path parameters that expand across a slash", () => {
	let compiled: CompiledFixture;
	let routes: ReturnType<typeof collectRoutes>;
	let operations: Map<string, HttpOperation>;

	beforeAll(async () => {
		compiled = await compileFixture(here, "reserved");
		const [services] = getAllHttpServices(compiled.program);
		const service = services[0];
		if (service === undefined) throw new Error("fixture declares no service");
		routes = collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service);
		operations = new Map(
			service.operations.map((operation) => [operation.operation.name, operation]),
		);
	}, 120_000);

	it("compiles, and finds routes to compare", () => {
		expect(compiled.diagnostics).toEqual([]);
		expect(routes.length).toBeGreaterThanOrEqual(7);
	});

	/**
	 * **The floor on both sides, and the second half is the one that matters.**
	 *
	 * An arm comparing two empty sets agrees perfectly. So does an implementation that returns every
	 * path parameter it sees, as long as the fixture has no ordinary ones. Requiring both classes to
	 * be present is what makes the comparison below capable of failing, and it is asserted as a COUNT
	 * of each class rather than as a list of names, so a fixture that grows keeps the floor honest.
	 */
	it("carries reserved AND ordinary path parameters, or the comparison proves nothing", () => {
		const reserved = routes.flatMap((route) => route.reservedPathParameters);
		expect(reserved.length).toBeGreaterThanOrEqual(5);

		const ordinary = [...operations.values()].flatMap((operation) =>
			operation.parameters.parameters.filter(
				(parameter) => parameter.type === "path" && !parameter.allowReserved,
			),
		);
		expect(ordinary.length).toBeGreaterThanOrEqual(2);
	});

	it("names exactly the parameters `@typespec/http` marks with the RFC 6570 `+` operator", () => {
		for (const route of routes) {
			const operation = operations.get(route.operationId);
			if (operation === undefined) throw new Error(`no operation for ${route.operationId}`);
			expect({
				operation: route.operationId,
				reserved: [...route.reservedPathParameters].toSorted(),
			}).toEqual({
				operation: route.operationId,
				reserved: reservedNamesInTemplate(operation.uriTemplate).toSorted(),
			});
		}
	});

	/**
	 * **The wire name, which is the only one a router can match on.**
	 *
	 * `@path("note-path") notePath` is `note-path` on the wire, and keying it by the TypeSpec property
	 * name is a defect this package has already shipped once, on headers: the emitted validator named
	 * a field no request carries, and 400'd every conformant caller.
	 */
	it("carries the WIRE name of a renamed parameter, and not the TypeSpec one", () => {
		const renamed = routes.find((route) => route.operationId === "readRenamed");
		expect(renamed?.reservedPathParameters).toEqual(["note-path"]);
	});

	it("treats reserved-ness as a property of the parameter, not of the route", () => {
		const mixed = routes.find((route) => route.operationId === "tree");
		// `/repo/{owner}/{+ref}` carries one of each, so a per-operation rule fails here.
		expect(mixed?.reservedPathParameters).toEqual(["ref"]);
		expect(mixed?.pathSchema).toContain("owner");
	});

	it("collects nothing for a route whose parameters are all ordinary", () => {
		expect(routes.find((route) => route.operationId === "plain")?.reservedPathParameters).toEqual(
			[],
		);
		expect(routes.find((route) => route.operationId === "none")?.reservedPathParameters).toEqual(
			[],
		);
	});
});

/**
 * **The document half: what openapi3 does with the same source.**
 *
 * Compiled separately because this needs the oracle rather than this emitter, and it writes into a
 * directory no other suite claims. Two things are pinned: upstream's own count of reserved
 * parameters, which no code here can influence, and the fact that the published path has the
 * operator stripped - the divergence this IR field exists to carry, stated rather than hidden.
 */
describe("the document cannot say it, which is why the route record has to", () => {
	const openapiDir = join(here, ".out", "reserved-openapi");
	let diagnostics: readonly { code: string; severity: string }[];
	let document: { paths?: Record<string, unknown> };
	let reservedCount: number;

	beforeAll(async () => {
		rmSync(openapiDir, { recursive: true, force: true });
		const program = await compile(NodeHost, join(here, "reserved.tsp"), {
			outputDir: openapiDir,
			emit: ["@typespec/openapi3"],
			options: {
				"@typespec/openapi3": {
					"emitter-output-dir": openapiDir,
					"openapi-versions": ["3.1.0"],
					"file-type": "json",
				},
			},
		});
		diagnostics = program.diagnostics.map((d) => ({ code: d.code, severity: d.severity }));
		const [services] = getAllHttpServices(program);
		const service = services[0];
		if (service === undefined) throw new Error("fixture declares no service");
		reservedCount = service.operations.flatMap((operation) =>
			operation.parameters.parameters.filter(
				(parameter) => parameter.type === "path" && parameter.allowReserved,
			),
		).length;
		const name = readdirSync(openapiDir).find((entry) => entry.endsWith(".json"));
		if (name === undefined) throw new Error("openapi3 wrote no document");
		document = JSON.parse(readFileSync(join(openapiDir, name), "utf8")) as typeof document;
	}, 120_000);

	it("writes a document, and openapi3 raises no error over reserved expansion", () => {
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(Object.keys(document.paths ?? {}).length).toBeGreaterThanOrEqual(7);
	});

	/**
	 * Upstream's own detector, counted. It fires once per reserved parameter per document, so this
	 * agrees with `allowReserved` without either side reading the other - and it is the arm that
	 * would notice openapi3 changing its mind about what it can express.
	 */
	it("warns once per reserved parameter, matching what the routes carry", () => {
		const warnings = diagnostics.filter(
			(d) => d.code === "@typespec/openapi3/path-reserved-expansion",
		);
		expect(reservedCount).toBeGreaterThanOrEqual(5);
		expect(warnings.length).toBe(reservedCount);
	});

	/**
	 * **The licensed divergence, pinned.** OpenAPI has no way to say "this one matches across a
	 * slash", so the published path is the ordinary template. Documented in `docs/reference.md`; if
	 * a future OpenAPI version gains the ability, this arm is what notices.
	 */
	it("publishes the path with the operator stripped, at every version it supports", () => {
		const paths = Object.keys(document.paths ?? {});
		expect(paths).toContain("/vault/{path}");
		expect(paths).toContain("/file/{note-path}");
		expect(paths).toContain("/vault/{path}/move");
		// The class, not only the members above: no published path carries an RFC 6570 operator.
		expect(paths.filter((path) => /\{[+#./;?&]/.test(path))).toEqual([]);
	});
});
