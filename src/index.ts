/**
 * The package's entry point: the public API, and the emitter written against it.
 *
 * Split in two deliberately. `api.ts` is everything a consumer may use — including another emitter,
 * which is what `typespec-hono` is — and `emitter.ts` is this package's own `$onEmit`, holding the
 * same position any consumer's would. Keeping them apart is what lets a test assert that the second
 * reaches only into the first.
 */
export * from "./api.js";
export { $onEmit } from "./emitter.js";
