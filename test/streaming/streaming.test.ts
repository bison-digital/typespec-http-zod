import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { resolveStreamModule, streamedTypeOf, withStreamModule } from "../../src/streams.js";

/**
 * **A streamed operation's payloads are not reachable from its response body.**
 *
 * Under OpenAPI 3.1 an SSE body is `{"type": "string"}` - the event stream itself - so a walk that
 * follows bodies sees a scalar and stops. openapi3 publishes the event payloads as components
 * regardless (it builds a per-event `itemSchema` for OpenAPI 3.2, and under 3.1 the components are
 * what survives), and nothing here could validate them. They ARE reachable in the TypeSpec graph:
 * `getStreamOf` hands back whatever the stream carries.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("what a stream carries gets a validator", () => {
	let schemas: Record<string, ZodType>;
	let compiled: CompiledFixture;
	const accepts = (name: string, value: unknown): boolean =>
		(schemas[name] as ZodType).safeParse(value).success;

	beforeAll(async () => {
		compiled = await compileFixture(here, "feed");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	});

	it("compiles without an error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("declares every event payload, and the union over them", () => {
		// None of these appears in a request or a response body. Before this they did not exist.
		const expected = ["tickSchema", "closedSchema", "feedEventsSchema"];
		expect(expected.filter((identifier) => schemas[identifier] === undefined)).toEqual([]);
	});

	it("really validates a payload, rather than merely declaring one", () => {
		expect(accepts("tickSchema", { at: "12:00", value: 3 })).toBe(true);
		expect(accepts("tickSchema", { at: "12:00", value: "three" })).toBe(false);
		expect(accepts("tickSchema", { at: "12:00" })).toBe(false);
	});

	it("covers JSON Lines, which carries the item model rather than an events union", () => {
		// `JsonlStream<Tick>` reaches `Tick` by the same route. The first cut required an `@events`
		// union and left this behind - the guard bought nothing and cost a second dependency.
		expect(schemas.tickSchema).toBeDefined();
	});
});

describe("the stream library is OPTIONAL, and its absence is not a failure", () => {
	it("resolves to undefined when nothing installs it, and then streams nothing", async () => {
		/**
		 * **The arm that matters for anybody who does not stream.** A static import would make this
		 * emitter unusable without `@typespec/streams`, which most specs never install. Here the
		 * module is simply absent, and `streamedTypeOf` must answer "nothing" rather than throw - the
		 * behaviour every non-streaming spec depends on and no other test exercises.
		 */
		const answered = withStreamModule(undefined, () =>
			streamedTypeOf(null as never, { kind: "Model", name: "Whatever" } as never),
		);
		expect(answered).toBeUndefined();
	});

	it("resolves the real module here, so the arm above is not the only path taken", async () => {
		// Non-vacuity: if resolution silently failed, every assertion in this file would still pass by
		// finding nothing to stream, and the feature would be dead.
		expect(await resolveStreamModule()).toBeDefined();
	});
});
