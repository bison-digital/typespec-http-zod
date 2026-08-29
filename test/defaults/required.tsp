import "@typespec/http";

using Http;

/**
 * A default on a REQUIRED property, which is a different construct from a default on an optional
 * one and had never been told apart from it.
 *
 * **`default` is an annotation, and `required` is the assertion.** JSON Schema 2020-12 makes
 * `default` an annotation keyword with no effect on validation, and `@typespec/openapi3` implements
 * exactly that: `#requiredModelProperties` builds the `required` list from `metadataInfo.isOptional`
 * alone and never consults a default, then attaches the default beside it as `schema.default`. So
 * the document below publishes `basis` as REQUIRED and annotates it with `"s1159"`.
 *
 * This emitter used to emit `.default("s1159")` for it, which makes the field optional on the way
 * in - so a request omitting `basis` was accepted by the validator and refused by the document
 * generated beside it. OAI/OpenAPI-Specification#1543 is closed on this exact question: writing a
 * default in before validating "is **NOT** part of validation".
 *
 * **Not refused, deliberately.** `unsupported-default` was once an error and was removed because
 * refusing a construct openapi3 emits makes the same spec representable by one emitter and not the
 * other. This spec is representable; the annotation on it is simply dead, because a required
 * property is never absent. So the validator says what the document says and the author is told.
 */
@service(#{ title: "required defaults" })
namespace RequiredDefaults;

model Inner {
  /** Required and defaulted, one level down - where a top-level-only rule cannot reach. */
  basis: string = "s1159";

  /** The control, beside it: optional and defaulted, which the document publishes as optional. */
  note?: string = "none";
}

model Outer {
  /** Required and defaulted at the top level. */
  kind: string = "standard";

  /** Required, no default: the property that must be unaffected. */
  id: string;

  inner: Inner;
}

@route("/outer")
@post
op create(@body body: Outer): void;

/**
 * A defaulted PARAMETER, which openapi3 publishes with `required: !param.optional` - the same rule
 * with a different spelling, so a fix applied to properties alone would leave this one wrong.
 */
@route("/rows")
@get
op list(@query size: int32 = 25, @query cursor?: string = ""): void;
