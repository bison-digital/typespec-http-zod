import type { ZodType } from "zod";

/**
 * **What generated code imports at run time - and the only thing this package puts in its output.**
 *
 * **Kept deliberately tiny, and deliberately free of every TypeSpec import.** The main entry point
 * is an emitter: it pulls in `@typespec/compiler` and exists at build time. This module is what an
 * *application* touches - an Express or Fastify service reading the arms this emitter wrote - and
 * making it reach the compiler would put a build-time dependency into a server's runtime graph for
 * the sake of two declarations. `test/packaging.test.ts` asserts the separation rather than trusting
 * it.
 *
 * A consumer may substitute this entirely: the `runtime-module` option decides the specifier the
 * generated files import from, so an application that wants its own declarations points at its own
 * module and re-declares these names.
 */

/**
 * One status an operation may answer with, and the schema the document publishes for it.
 *
 * `when` is present only where an operation declares two success arms discriminated by a property of
 * the result - the application reads that property, because only it knows how to see inside its own
 * result envelope. Everything else about the choice is decided at generation time.
 *
 * **Failure arms are here too, and for a while they were not.** The document declares what an
 * error response looks like, and the generated server passed on only the success statuses - so an
 * application could not check what it sends when something goes wrong, because the schema never
 * arrived. Measured on one service: `401` and two `default` responses declared, zero emitted.
 *
 * **The arms arrive in OpenAPI's precedence order, so the FIRST match is the right one.** An exact
 * code, then a range, then the catch-all. That ordering is not a convention invented here: the
 * Responses Object says "if a response is defined using an explicit code, the explicit code
 * definition takes precedence over the range definition for that code", and `default` means every
 * status not otherwise listed. Sorting once at generation time is what keeps every application from
 * re-deriving the rule - and from getting it silently wrong when a `404` and a `4XX` both apply.
 *
 * **`schema: undefined` is a statement, not an absence.** A response the document says carries no
 * body has no validator, and that is the truthful answer. It is also why the generated arms are
 * annotated with `satisfies readonly ResponseArm[]` rather than `as const`: measured, `as const`
 * catches a wrong `status` but is **blind** to a misspelled or omitted `schema`, because a bodyless
 * arm is legitimate - so the typo produces a valid-looking arm that validates nothing.
 */
export interface ResponseArm {
	/**
	 * The media types this response offers, where the document names more than one.
	 *
	 * Absent where it names one, which is what an application already assumes. Present, it is the set
	 * to negotiate against: `selectContentType` takes the caller's `Accept` and these.
	 */
	readonly contentTypes?: readonly string[];
	/**
	 * The headers this response declares, as the document publishes them.
	 *
	 * **Two names, because two different things need them.** `name` is the WIRE name, which is what
	 * the response sets; `property` is the name on the value the handler returned, which is where the
	 * value is read from. `@header("x-correlation-id") correlationId: string` is `x-correlation-id`
	 * on the wire and `correlationId` in the result.
	 *
	 * Absent where the response declares none, so "none declared" and "none carried" are the same
	 * thing rather than two states an application has to tell apart.
	 */
	readonly headers?: readonly { readonly name: string; readonly property: string }[];
	/**
	 * The status this arm answers with: an exact code, a `4XX`-style range, or the catch-all.
	 *
	 * **`"default"` is carried as itself, not resolved to a number.** OpenAPI's `default` response
	 * means "any status not listed", and an emitter picking one would be answering a question the
	 * contract deliberately left to the application. The application maps its own failure to a status;
	 * this says which schema the body must match once it has.
	 *
	 * **A range is carried as itself for the same reason, and it used to be dropped entirely.**
	 * `@minValue(400) @maxValue(499) @statusCode _: int32` is a `4XX` entry in the document; the
	 * emitter handled `"*"` and exact numbers and emitted nothing at all for the third case, so a
	 * service could publish a whole class of failures with no arm to check them against. Expanding
	 * `4XX` to a hundred arms would be inventing statuses the contract never listed - the range IS
	 * what the document says, and matching against it is the application's to do, once, here.
	 */
	readonly status: number | "default" | `${1 | 2 | 3 | 4 | 5}XX`;
	readonly schema: ZodType | undefined;
	readonly when?: { readonly property: string; readonly value: boolean | string };
}

/**
 * The arm that governs a status - **the rule the OpenAPI specification states, applied once here.**
 *
 * An application knows which status it is answering with; the document knows which schema that status
 * has to match. Joining the two means resolving an overlap, because `404`, `4XX` and `default` can
 * all be declared on one operation and all three describe a 404. The Responses Object settles it: a
 * range MAY be given as an uppercase `X` wildcard, and "if a response is defined using an explicit
 * code, the explicit code definition takes precedence over the range definition for that code".
 * `default` is by definition every status not otherwise listed, so it is last.
 *
 * **Shipped beside the arms rather than left to the caller, because this is where it goes wrong.**
 * Left to applications it gets written as "the first arm with a status >= 400" - which is literally
 * what one consumer's wiring did before ranges existed, and which silently skips every range arm
 * while looking correct. A package that emits an array containing `4XX` and `default` and does not
 * ship the rule for reading it has shipped a footgun.
 *
 * The emitter already sorts the arms into this order, so the scan is a formality on generated input.
 * It is written to be independent of that anyway: an ordering assumption that only one side knows
 * about is a coupling nobody can see.
 */
export function armFor(arms: readonly ResponseArm[], status: number): ResponseArm | undefined {
	return (
		arms.find((arm) => arm.status === status) ??
		arms.find((arm) => arm.status === `${Math.floor(status / 100) as 1 | 2 | 3 | 4 | 5}XX`) ??
		arms.find((arm) => arm.status === "default")
	);
}
