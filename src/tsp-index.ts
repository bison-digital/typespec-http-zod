/**
 * What TypeSpec's compiler loads for this library.
 *
 * **There is deliberately no `$decorators` export.** A decorator of this library's own would let
 * the spec state something `@typespec/openapi3` cannot publish, so the emitted validator would
 * enforce a rule no caller reading the contract can see. A decorator here is not a convenience; it
 * is a second contract. If a spec needs to say something, it says it in a way the document carries.
 *
 * That is asserted as a class, not left to discipline: see `test/vocabulary.test.ts`.
 */
export { $lib } from "./lib.js";
