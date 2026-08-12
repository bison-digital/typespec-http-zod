/**
 * What TypeSpec's compiler loads for this library.
 *
 * ⚠️ **There is deliberately no `$decorators` export.** This emitter's ancestor defined four —
 * `@trimmed`, `@loose`, `@externalValues` and `@refine` — and every one of them let the spec state
 * something `@typespec/openapi3` could not publish, so the emitted validator enforced a rule no
 * caller reading the contract could see. A decorator here is not a convenience; it is a second
 * contract. If a spec needs to say something, it says it in a way the document carries.
 *
 * That is asserted as a class, not left to discipline: see `test/vocabulary.test.ts`.
 */
export { $lib } from "./lib.js";
