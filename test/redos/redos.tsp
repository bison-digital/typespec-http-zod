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

  /**
   * **Safe WITHOUT the `u` flag and dangerous WITH it**, which is the only shape that can prove
   * the analysis carries the flag the emitter actually emits. Without the flag `\\p` is the
   * identity escape for the letter `p`, so `(p{L}+)+` is not the ambiguity it looks like and
   * `redos-detector` returns SAFE. With the flag it is a quantifier nested over a Unicode
   * property class, and it returns UNSAFE. Measured both ways before this was added.
   */
  @pattern("^(\\p{L}+)+$")
  unicodeOnlyDanger: string;

  /**
   * Both at once: a quantifier nested over an overlapping class, AND a redundant `\-` the `u`
   * flag refuses. One declaration, two independent things wrong with it, so the author should
   * hear about both in one compile rather than one per compile.
   */
  @pattern("^(\\w+\\s?)*\\-$")
  doubleTrouble: string;
}

@route("/things")
interface Things {
  @get read(@path id: Ident, @query term?: Words, @query handle?: Handle): Thing;
}
