import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllHttpServices } from "@typespec/http";
import { beforeAll, describe, expect, it } from "vitest";
import { collectRoutes, type EmittedRoute } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import type { ResponseArm } from "../../src/runtime.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Each arm is complete on its own.** See `complete.tsp`.
 *
 * Graded two ways, and neither by matching emitted text where a value can be read instead: the arm
 * lists are LOADED, so an arm's schema is compared by identity with the component it must be, and
 * the route record is read through the published API for the facts no emitted file carries.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: string;
let emitted: Record<string, unknown>;
let routes: readonly EmittedRoute[];

beforeAll(async () => {
	compiled = await compileFixture(here, "complete", { outName: "complete" });
	schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
	emitted = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
	const [services] = getAllHttpServices(compiled.program);
	const service = services[0];
	if (service === undefined) throw new Error("fixture declares no service");
	routes = collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service);
}, 300_000);

function armsOf(operationId: string): readonly ResponseArm[] {
	const arms = emitted[`${operationId}Responses`];
	if (!Array.isArray(arms)) throw new Error(`no ${operationId}Responses was emitted`);
	return arms as ResponseArm[];
}

function armOf(operationId: string, status: ResponseArm["status"]): ResponseArm {
	const arm = armsOf(operationId).find((candidate) => candidate.status === status);
	if (arm === undefined) throw new Error(`${operationId} has no arm for ${String(status)}`);
	return arm;
}

function routeOf(operationId: string): EmittedRoute {
	const route = routes.find((candidate) => candidate.operationId === operationId);
	if (route === undefined) throw new Error(`no route for ${operationId}`);
	return route;
}

describe("the fixture compiles", () => {
	it("raises no error of ours", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("emits output that typechecks", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});
});

describe("two success statuses with different bodies", () => {
	it("gives each status the body its own response declares", () => {
		expect(armOf("two", 200).schema).toBe(emitted.noteSchema);
		expect(armOf("two", 202).schema).toBe(emitted.ticketSchema);
	});

	it("carries no selector, because the handler names the status itself", () => {
		for (const arm of armsOf("two")) expect(Object.keys(arm)).not.toContain("when");
	});
});

describe("a failure arm is as complete as a success arm", () => {
	it("carries the headers an exact failure status declares", () => {
		expect(armOf("guarded", 429).headers).toEqual([{ name: "retry-after", optional: false }]);
	});

	it("carries the headers a failure RANGE declares, optional ones marked", () => {
		expect(armOf("guarded", "4XX").headers).toEqual([{ name: "x-maybe", optional: true }]);
	});

	it("carries the media types of an exact status, a range and the catch-all", () => {
		expect(armOf("guarded", 429).contentTypes).toEqual(["application/json"]);
		expect(armOf("guarded", "4XX").contentTypes).toEqual(["application/json"]);
		expect(armOf("guarded", "default").contentTypes).toEqual(["application/json"]);
	});

	it("publishes each header's TypeScript type on the route, so a signature can carry it", () => {
		const tooMany = routeOf("guarded").responses.find((response) => response.status === 429);
		expect(tooMany?.headers).toEqual([{ name: "retry-after", type: "number", optional: false }]);
	});

	it("orders arms the way OpenAPI resolves them: exact, then range, then default", () => {
		expect(armsOf("guarded").map((arm) => arm.status)).toEqual([200, 429, "4XX", "default"]);
	});
});

describe("a success declared only as a range", () => {
	it("is emitted rather than dropped", () => {
		expect(armsOf("ranged").map((arm) => arm.status)).toEqual(["2XX"]);
		expect(armOf("ranged", "2XX").schema).toBe(emitted.noteSchema);
	});
});

describe("an inline body has a name", () => {
	it("refers to every arm's schema by an identifier, success and failure alike", () => {
		const line = /^export const inlineResponses = .*$/m.exec(schemas)?.[0] ?? "";
		expect(line, "no inlineResponses line").not.toBe("");
		expect(line).toMatch(/status: 404, schema: [A-Za-z_$][\w$]*/);
		// An inline expression inside the arm list is a schema nothing else can name.
		expect(line).not.toMatch(/\bz\./);
	});

	it("declares those identifiers as loadable schemas", () => {
		expect(armOf("inline", 200).schema).toBeDefined();
		expect(armOf("inline", 404).schema).toBeDefined();
		expect(armOf("inline", 404).schema).not.toBe(armOf("inline", 200).schema);
	});
});

describe("whether a non-JSON body is text a server can serve as is", () => {
	it("marks a string body textual and a model body not", () => {
		expect(routeOf("text").responses.map((response) => response.textual)).toEqual([true]);
		expect(routeOf("xml").responses.map((response) => response.textual)).toEqual([false]);
	});

	it("keeps each media type on the arm, so the two are told apart by what the document says", () => {
		expect(armOf("text", 200).contentTypes).toEqual(["text/plain"]);
		expect(armOf("xml", 200).contentTypes).toEqual(["application/xml"]);
	});
});
