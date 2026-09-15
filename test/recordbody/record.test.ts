import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { NodeHost, compile } from "@typespec/compiler";
import { getAllHttpServices } from "@typespec/http";
import { join } from "node:path";
import { collectRoutes } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";

/** See `record.tsp`. The fact is read from the resolved model, so it is asserted on the IR. */

const here = fileURLToPath(new URL(".", import.meta.url));
let routes: Awaited<ReturnType<typeof collect>>;

async function collect() {
	const program = await compile(NodeHost, join(here, "record.tsp"), { noEmit: true });
	const [services] = getAllHttpServices(program);
	const service = services[0];
	if (service === undefined) throw new Error("no service");
	return collectRoutes(program, new SchemaRegistry(program), service);
}

beforeAll(async () => {
	routes = await collect();
}, 300_000);

describe("a request body with an indexer", () => {
	it("collected every operation, so the arms below compare something", () => {
		expect(routes.map((route) => route.operationId).toSorted()).toEqual([
			"b",
			"e",
			"j",
			"s",
			"u",
			"x",
			"y",
			"z",
		]);
	});

	it("is named rather than spread", () => {
		const x = routes.find((route) => route.operationId === "x");
		expect(x?.bodyProperty).toBe("body");
	});

	it("names it for a form body too, where a declared content type changes the resolution", () => {
		const z = routes.find((route) => route.operationId === "z");
		expect(z?.bodyProperty).toBe("body");
	});

	it("leaves an ordinary model body spread, so nothing else moved", () => {
		const y = routes.find((route) => route.operationId === "y");
		expect(y?.bodyProperty).toBeUndefined();
	});
});

describe("a request body that is not a model", () => {
	const routeFor = (operationId: string) =>
		routes.find((route) => route.operationId === operationId);

	it.each([
		["a scalar", "s"],
		["an enum", "e"],
		["a union", "u"],
		["a scalar a caller sends as JSON", "j"],
	])("names %s body rather than spreading it", (_what, operationId) => {
		expect(routeFor(operationId)?.bodyProperty).toBe("body");
	});

	it("leaves a bytes body to rawBodyProperty, so one value is not named twice", () => {
		const b = routeFor("b");
		expect(b?.rawBodyProperty).toBe("body");
		expect(b?.bodyProperty).toBeUndefined();
	});
});

describe("whether the body IS the text a caller sends", () => {
	const routeFor = (operationId: string) =>
		routes.find((route) => route.operationId === operationId);

	/**
	 * A server needs this to read the body at all: `text/plain` has no JSON, form or multipart reader,
	 * and `typespec-hono` emitted no body middleware for one, so the handler received nothing.
	 */
	it("is true for a string body under a media type that is not JSON", () => {
		expect(routeFor("s")?.requestTextual).toBe(true);
		expect(routeFor("s")?.requestContentTypes).toEqual(["text/plain"]);
	});

	it("is false for the same type sent as JSON, which the JSON reader parses", () => {
		expect(routeFor("j")?.requestTextual).toBe(false);
	});

	it.each([
		["a model", "y"],
		["a dictionary", "x"],
		["bytes", "b"],
		["an enum", "e"],
	])("is false for %s body, which is not text however it is framed", (_what, operationId) => {
		expect(routeFor(operationId)?.requestTextual).toBe(false);
	});
});
