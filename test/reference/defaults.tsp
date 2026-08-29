import "@typespec/http";

using Http;

/**
 * Default values, in both spellings, for the differential to compare against the document.
 *
 * **The corpus reaches none of this.** Measured across every compiled document in this repository:
 * zero component schemas carried a property-level `default`, so the arm comparing emitted validators
 * against `@typespec/openapi3`'s output had never once seen the keyword. That is precisely the gap
 * that let this emitter treat a default as an optionality for its whole life.
 *
 * **Only the OPTIONAL spelling is here, and that is deliberate.** `p: T = v` - required, with a
 * default that can never apply - raises `default-on-required-property`, and the arm beside this one
 * asserts **zero emitter warnings across the corpus** on the grounds that a warning means the
 * emitter is knowingly shipping output the document does not describe. This warning does not mean
 * that: the output it produces is exactly what the document describes, and what is being reported is
 * that the author's annotation is dead. Putting the spelling here would conflate the two meanings
 * permanently. It is graded in `test/defaults/required.tsp`, by diagnostic and by parse.
 *
 * `default` is compared as an ANNOTATION rather than an assertion - the same clause of JSON Schema
 * 2020-12 that puts `format`, `contentEncoding` and `contentMediaType` in that set.
 */
@service(#{ title: "defaults" })
namespace Defaults;

model Nested {
  /** Optional and defaulted, one level down - where a top-level rule cannot reach. */
  scale?: float64 = 1.0;

  /** Required, no default, at depth: the property a caller must still supply. */
  unit: string;
}

model Settings {
  /** The plain scalar cases, one per JSON type the emitter renders as a literal. */
  label?: string = "untitled";
  count?: int32 = 3;
  enabled?: boolean = true;

  /** Composite literals, which openapi3 publishes verbatim. */
  tags?: string[] = #["a", "b"];
  origin?: Nested = #{ scale: 2.0, unit: "em" };

  /** Required, no default: the property that must be unaffected by any of this. */
  id: string;

  nested: Nested;
}

@route("/settings")
@post
op saveSettings(@body body: Settings): Settings;

/**
 * A defaulted PARAMETER, which openapi3 publishes with `required: !param.optional` - the same rule
 * as a property, spelled differently, so a fix applied to one and not the other would leave a hole.
 */
@route("/settings/search")
@get
op searchSettings(@query size?: int32 = 25, @query order?: string = "asc"): Settings[];
