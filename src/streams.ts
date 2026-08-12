import type { Program, Type } from "@typespec/compiler";

/**
 * Optional support for `@typespec/streams`.
 *
 * ⚠️ **Lazily imported, and absent is a normal answer.** It is a separate library most specs never
 * install, so a static import would make this emitter unusable without it. The structure follows
 * `@typespec/openapi3`'s own `sse-module.js` — an optional peer dependency, a guarded `import()`,
 * and `undefined` when it is missing — because an emitter that resolves it differently from the
 * reference implementation will disagree with it about which specs it can serve. openapi3 needs
 * `@typespec/events` and `@typespec/sse` as well, to build the per-event `itemSchema` OpenAPI 3.2
 * carries; this emitter only needs to know WHAT is streamed, so one is enough.
 *
 * **Why this exists at all.** An SSE operation returns `SSEStream<UnnamedEvents>`, and under
 * OpenAPI 3.1 its response body is `{"type": "string"}` — the event stream itself. The event
 * PAYLOADS (`Unnamed.Info`, `Named.ResponseCreated`, …) are published as components that no path
 * references: openapi3 builds `itemSchema` describing them for OpenAPI 3.2, and under 3.1 emits the
 * components as a by-product. Measured: the 3.1 document mentions neither `itemSchema` nor
 * `contentSchema`, yet declares all five payload models.
 *
 * They are still part of the published vocabulary, and reachable in the TypeSpec graph even though
 * the 3.1 paths do not reach them — `getStreamOf` hands back whatever the stream carries, an
 * `@events` union for SSE and the item model for JSON Lines. So the payloads get validators, and a
 * consumer streaming events has something to check each `data:` against.
 */

export interface StreamModule {
	/** The type a stream carries — an `@events` union for SSE, the item model for JSON Lines. */
	readonly streamOf: (program: Program, type: Type) => Type | undefined;
}

export async function resolveStreamModule(): Promise<StreamModule | undefined> {
	let streams;
	try {
		streams = (await import("@typespec/streams")) as {
			getStreamOf: (program: Program, type: Type) => Type | undefined;
		};
	} catch {
		return undefined;
	}
	return {
		streamOf: (program, type) =>
			type.kind === "Model" ? streams.getStreamOf(program, type) : undefined,
	};
}

/**
 * Scoped rather than threaded through the walk, matching the idiom the rest of this emitter uses for
 * cross-cutting context (`withVisibility`, `withSealedObjects`, `withRefResolver`). Resolving the
 * module is asynchronous and the walk is not, so it is resolved once in `$onEmit` and read here.
 */
let current: StreamModule | undefined;

export function withStreamModule<T>(module: StreamModule | undefined, run: () => T): T {
	const previous = current;
	current = module;
	try {
		return run();
	} finally {
		current = previous;
	}
}

/**
 * What an operation streams, or `undefined` when it streams nothing — which is every operation in a
 * spec that does not use these libraries, and every ordinary operation in one that does.
 *
 * ⚠️ **Whatever the stream carries, not only an `@events` union.** The first cut required
 * `isEvents`, which fixed SSE and left `JsonlStream<Info>` behind: JSON Lines carries the item model
 * directly. The guard bought nothing — the streamed type is the published vocabulary in both cases —
 * and dropping it removed a second optional dependency along with the special case.
 */
export function streamedTypeOf(program: Program, returnType: Type): Type | undefined {
	return current?.streamOf(program, returnType);
}
