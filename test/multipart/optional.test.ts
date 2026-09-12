import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { NodeHost, compile } from "@typespec/compiler";
import { getAllHttpServices } from "@typespec/http";
import { join } from "node:path";
import { collectRoutes } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";

/**
 * See `optional.tsp`. **A body that may be absent is NAMED, whatever kind of body it is.**
 *
 * `requestBodyOf` resolves a type only for `bodyKind === "single"`, so the disjunct that decides
 * `bodyProperty` was unreachable for a multipart body. Both spellings now reach the same rule, and
 * both required spellings are held unchanged beside them.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let routes: Awaited<ReturnType<typeof collect>>;

async function collect() {
	const program = await compile(NodeHost, join(here, "optional.tsp"), { noEmit: true });
	const [services] = getAllHttpServices(program);
	const service = services[0];
	if (service === undefined) throw new Error("no service");
	return collectRoutes(program, new SchemaRegistry(program), service);
}

beforeAll(async () => {
	routes = await collect();
}, 300_000);

function route(operationId: string) {
	return routes.find((candidate) => candidate.operationId === operationId);
}

describe("an optional body is named whatever kind it is", () => {
	it("collected all four operations, so the arms below compare something", () => {
		expect(routes.map((candidate) => candidate.operationId).toSorted()).toEqual([
			"optionalMultipart",
			"optionalSingle",
			"requiredMultipart",
			"requiredSingle",
		]);
	});

	it("names an optional MULTIPART body", () => {
		expect(route("optionalMultipart")?.optionalBody).toBe(true);
		expect(route("optionalMultipart")?.bodyProperty).toBe("body");
	});

	it("names an optional SINGLE body, which is the rule this one was extended from", () => {
		expect(route("optionalSingle")?.optionalBody).toBe(true);
		expect(route("optionalSingle")?.bodyProperty).toBe("body");
	});

	it("leaves a REQUIRED multipart body spread, so the fix did not widen", () => {
		expect(route("requiredMultipart")?.optionalBody).toBe(false);
		expect(route("requiredMultipart")?.bodyProperty).toBeUndefined();
	});

	it("leaves a REQUIRED single body spread, so nothing else moved", () => {
		expect(route("requiredSingle")?.optionalBody).toBe(false);
		expect(route("requiredSingle")?.bodyProperty).toBeUndefined();
	});
});
