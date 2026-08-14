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
	it("collected both operations, so the arms below compare something", () => {
		expect(routes.map((route) => route.operationId).toSorted()).toEqual(["x", "y"]);
	});

	it("is named rather than spread", () => {
		const x = routes.find((route) => route.operationId === "x");
		expect(x?.bodyProperty).toBe("body");
	});

	it("leaves an ordinary model body spread, so nothing else moved", () => {
		const y = routes.find((route) => route.operationId === "y");
		expect(y?.bodyProperty).toBeUndefined();
	});
});
