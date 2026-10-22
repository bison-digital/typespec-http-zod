import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllHttpServices } from "@typespec/http";
import { getOpenAPI3 } from "@typespec/openapi3";
import { beforeAll, describe, expect, it } from "vitest";
import { collectRoutes, type EmittedRoute, resultMembersOf } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A body declared `void` is no body, so no media type is listed for it.** See `nobody.tsp`.
 *
 * `EmittedResponse.contentTypes` is "empty exactly when the response carries no body", and it
 * listed `application/json` for a 409 declared `@body body: void`, beside `schema: undefined` - which
 * an emitter built on this one reads as a body it cannot validate, and refuses the operation. On a
 * request the same declaration reached the Zod walk and refused the compile.
 * **Graded against the document**, which publishes no `content` for `void`. A `never` body is
 * refused; see `test/neverbody`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let routes: readonly EmittedRoute[];
let paths: Record<
	string,
	Record<
		string,
		{
			requestBody?: { content?: Record<string, unknown> };
			responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
		}
	>
>;

beforeAll(async () => {
	compiled = await compileFixture(here, "nobody", { outName: "nobody" });
	const [[service]] = getAllHttpServices(compiled.program);
	if (service === undefined) throw new Error("no service");
	routes = collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service);
	const [record] = await getOpenAPI3(compiled.program, { "openapi-versions": ["3.1.0"] });
	paths = (
		JSON.parse(
			JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
		) as {
			paths: typeof paths;
		}
	).paths;
}, 300_000);

const route = (operationId: string) => {
	const found = routes.find((candidate) => candidate.operationId === operationId);
	if (found === undefined) throw new Error(`no route ${operationId}`);
	return found;
};
const response = (status: number) => route("responses").responses.find((r) => r.status === status);

describe("what the document publishes for a void body", () => {
	it("publishes no content for `void`, on a response and on a request", () => {
		expect(paths["/responses"]?.["get"]?.responses["409"]?.content).toBeUndefined();
		expect(paths["/void"]?.["post"]?.requestBody).toBeUndefined();
	});
});

describe("an empty body, as the emitted artefacts state it", () => {
	it("compiles without a diagnostic", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	it("lists no media type for a response declared `void`, as the document does", () => {
		expect(response(409)).toMatchObject({ schema: undefined, contentTypes: [] });
	});

	it("keeps the media type of a response that has a body", () => {
		expect(response(200)?.contentTypes).toEqual(["application/json"]);
	});

	it("answers each empty response as one result member with no media type", () => {
		const members = resultMembersOf(route("responses").responses, (r) => r.schema !== undefined);
		for (const status of [409]) {
			const answering = members.filter((member) => member.response.status === status);
			expect(answering.map((member) => [member.mediaType, member.serving])).toEqual([
				[undefined, "none"],
			]);
		}
	});

	it("takes no body on a request declared `void`, as the document publishes none", () => {
		for (const operationId of ["voidRequest"]) {
			expect(route(operationId)).toMatchObject({
				requestContentTypes: [],
				requestSchema: undefined,
				bodyProperty: undefined,
			});
		}
	});

	it("states no input for such a request", () => {
		const file = join(compiled.outDir, "consumer.ts");
		writeFileSync(
			file,
			`import type { WireInputs } from "./requests.gen.js";

type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;
export type Void = MustHold<Identical<WireInputs["voidRequest"], Record<string, never>>>;
`,
		);
		try {
			const { output, failed } = typecheckEmitted(compiled.outDir);
			expect(output).toBe("");
			expect(failed).toBe(false);
		} finally {
			rmSync(file, { force: true });
		}
	});
});
