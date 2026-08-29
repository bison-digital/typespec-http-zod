import "@typespec/http";

using Http;

/**
 * **The constraint depth fixture - breadth of keywords, not breadth of API.**
 *
 * **This exists because the conformance corpus declares NO constraints at all, and believing
 * otherwise made an arm vacuous for a long time.** Measured on `@typespec/http-specs@0.1.0-alpha.40`:
 * across every scenario it compiles, the differential extracted **zero** `minLength`, `maxLength`,
 * `pattern`, `minItems`, `maxItems`, `minValue` or `maxValue` from either side - `http-specs` tests
 * protocol behaviour, not validation. So the constraint arm reported agreement while reading nothing,
 * which is the most expensive kind of green.
 *
 * The un-split emitter closed that gap with a 444-line fixture belonging to one company's domain.
 * That does not travel, and its shape was wrong for the job anyway: depth came incidentally, from
 * whichever constraints that product happened to need.
 *
 * So this is deliberate and narrow. **Every constraint keyword `applyConstraints` supports appears
 * exactly once, on the type it is legal on.** The service around them is the smallest thing that
 * makes the models reachable - a constraint on a model nothing references is never walked.
 *
 * **Constraints must sit on ordinary body properties.** `@minValue`/`@maxValue` on a `@statusCode`
 * are HTTP metadata, stripped from every body before either emitter sees them, which is precisely
 * why the corpus's only two bounds were invisible to this arm.
 */
@service(#{ title: "Constraints" })
namespace Constraints;

// --- String --------------------------------------------------------------------------------------

/**
 * Anchored **in the spec**. JSON Schema's `pattern` is explicitly not implicitly anchored, so an
 * emitter adding `^`/`$` itself publishes one expression and enforces another - and `^` binds looser
 * than `|`, which silently changes the meaning of any top-level alternation.
 */
@pattern("^[A-Z]{2}-\\d{4}$")
scalar Reference extends string;

model StringBounds {
  /** `@minLength` and `@maxLength` together: rejects "" and rejects 65 characters. */
  @minLength(1)
  @maxLength(64)
  name: string;

  /** The pattern is read from the scalar the property NAMES, not from `string` underneath it. */
  reference: Reference;

  /** A pattern applied directly, so both roads to `@pattern` are walked. */
  @pattern("^[a-z0-9-]+$")
  slug: string;

  /**
   * **A lower bound above 1, which is the only shape that exposes the LOOSER direction.**
   *
   * A length bound is checked in code points by JSON Schema and was checked in UTF-16 units by Zod
   * before 4.5, so one astral character counted as two. With `@minLength(1)` the two answers coincide
   * for every input and the disagreement is invisible; at 3, two emoji are 2 code points and 4 units,
   * so the document REFUSES what the validator accepted - a payload the contract forbids reaching a
   * handler, which is the direction a server cannot afford. `behaviour.test.ts` grades it.
   */
  @minLength(3)
  @maxLength(8)
  handle: string;

  /** Deliberately unconstrained - an arm that only ever sees constrained values is half-blind. */
  note?: string;
}

// --- Numeric -------------------------------------------------------------------------------------

model NumericBounds {
  /** Inclusive bounds: rejects -1 and rejects 101. */
  @minValue(0)
  @maxValue(100)
  percent: int32;

  /**
   * **Exclusive bounds are a DIFFERENT keyword, and collapsing them to inclusive is a real bug.**
   * `.min(0)` accepts a zero rate; `@minValueExclusive(0)` is `.gt(0)` and does not.
   */
  @minValueExclusive(0)
  @maxValueExclusive(1)
  rate: float64;

  /** Unconstrained, for the same reason `note` above is. */
  count?: int32;
}

// --- Collections ---------------------------------------------------------------------------------

model CollectionBounds {
  /** `@minItems` and `@maxItems`: rejects [] and rejects a seventh element. */
  @minItems(1)
  @maxItems(6)
  tags: string[];

  /** Bounded array, definite element type - the ordinary case both sides must agree on. */
  ids: string[];

  /** Elements carrying a constraint of their own, through the scalar they name. */
  aliases: Reference[];

  scores: int32[];

  /**
   * **Genuinely OPEN elements - `items: {}` in the document, meaning "anything".**
   *
   * A separate reading from "an array with no bounds", and the distinction cost real coverage once.
   * The document's empty schema states that a value is unconstrained; a harness that reads it as
   * *unreadable* skips the position, and the skip counts as coverage - so a validator that
   * OVER-constrains an open element is invisible. That blindness is one-directional, which is why it
   * survived: under-constraining always read on both sides.
   *
   * `string[]` cannot exercise it. Its element kind is `string`, which is a definite answer, not an
   * open one - this fixture's first draft claimed otherwise in a comment while declaring exactly
   * that, which is the same mistake one level down.
   */
  payloads: unknown[];

  /** A second open position, so the counter cannot be satisfied by one lucky declaration. */
  attachments: unknown[];

  /** An open element reached through a dictionary value rather than directly. */
  buckets: Record<unknown>[];
}

// --- Operations ----------------------------------------------------------------------------------

/** Constraints on a REQUEST body - the position a validator actually guards. */
@route("/strings")
@post
op putStrings(@body body: StringBounds): StringBounds;

@route("/numbers")
@post
op putNumbers(@body body: NumericBounds): NumericBounds;

@route("/collections")
@post
op putCollections(@body body: CollectionBounds): CollectionBounds;

/**
 * Constraints on QUERY parameters, which is a different walk from a body property and has had its
 * own defects - a bound that survives into a body schema and is dropped from a parameter schema
 * would be invisible to a component-only comparison.
 */
@route("/search")
@get
op search(
  @minLength(2)
  @maxLength(32)
  @query term: string,

  @minValue(1)
  @maxValue(50)
  @query limit?: int32,
): CollectionBounds;
