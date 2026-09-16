import "@typespec/http";

using Http;

/**
 * Patterns an API definition plausibly carries, on both sides of the line.
 *
 * Every dangerous one here was MEASURED against the engine Zod runs on, on the input the analyser's
 * own reasoning points at, rather than assumed from its shape.
 */
@service(#{ title: "Redos" })
namespace Redos;

/** `^(\w+\s?)*$` is what an author writes to mean "words". 31 bytes cost 7.8 s on a live worker. */
@pattern("^(\\w+\\s?)*$")
scalar Words extends string;

/** Reads as ordinary, and takes 11 seconds on a 29-character input. Measured. */
@pattern("^\\w+([.-]?\\w+)*$")
scalar Handle extends string;

/** Safe: no input matches two ways. The hyphen separator is required, so the split is forced. */
@pattern("^[a-z]+(-[a-z]+)*$")
scalar Slug extends string;

/** Safe, and the shape this repository's own docblock recommends for a whole-string match. */
@pattern("^\\S(?:[\\s\\S]*\\S)?$")
scalar Trimmed extends string;

/** Safe: fixed repetition, nothing nested. */
@pattern("^[0-9a-f]{8}-[0-9a-f]{4}\\-[0-9a-f]{4}$")
scalar Ident extends string;

model Thing {
  id: Ident;
  slug: Slug;
  label: Trimmed;
  /** The dangerous one on a property rather than a scalar, so both report sites are exercised. */
  @pattern("^(a|a)+$")
  doubled: string;
}

@route("/things")
interface Things {
  @get read(@path id: Ident, @query term?: Words, @query handle?: Handle): Thing;
}
