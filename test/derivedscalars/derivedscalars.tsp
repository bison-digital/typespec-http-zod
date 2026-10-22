import "@typespec/http";

using Http;

/**
 * **A scalar extending a constrained scalar is constrained by both, as the document says.**
 *
 * `@typespec/openapi3` builds a derived scalar's schema from its base's - `#getSchemaForScalar`
 * recurses into `baseScalar` and then applies the derived scalar's own decorators over the result -
 * so `scalar Inherits extends Word` publishes `Word`'s `pattern`. This emitter read the decorators of
 * the scalar a property NAMED and stopped there: `inherits` validated as a bare `z.string()`, and
 * every value the document refuses was accepted.
 *
 * The override rows are the other half of the rule. Where a derived scalar declares a keyword its
 * base also declares, the document keeps only the derived one: `Overrides` publishes `^x+$` and not
 * `^[a-w]+$`, so `"xx"` is valid. Applying both would refuse it.
 */
@service(#{ title: "Derived scalars" })
namespace DerivedScalars;

@pattern("^[a-w]+$")
scalar Word extends string;

scalar Inherits extends Word;

@maxLength(3)
scalar ShortWord extends Word;

@pattern("^x+$")
scalar Overrides extends Word;

scalar Deeper extends ShortWord;

@minValue(1)
scalar Positive extends int32;

@maxValue(9)
scalar Digit extends Positive;

@minValue(5)
scalar AtLeastFive extends Positive;

model Values {
  inherits: Inherits;
  shortWord: ShortWord;
  overrides: Overrides;
  deeper: Deeper;
  digit: Digit;
  atLeastFive: AtLeastFive;
}

@route("/values")
@post
op create(@body body: Values): Values;
