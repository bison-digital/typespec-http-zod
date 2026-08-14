import "@typespec/http";

using Http;

/**
 * Constructs a spec author can reach that once produced an unlocated refusal.
 *
 * `Record<never>` is how TypeSpec states "and nothing else". It is not a value type to walk, and
 * `@typespec/openapi3` publishes it as `additionalProperties: {not: {}}` with no diagnostic at all.
 */
@service(#{ title: "located" })
namespace Located;

/** A closed model, with the spread before the declared property. */
model ClosedFirst {
  ...Record<never>;
  name: string;
}

/** The same, spread last, because the two orders reached the walk differently. */
model ClosedLast {
  other: string;
  ...Record<never>;
}

/** A union with a `never` variant, which collapses to the variant that remains. */
model UnionWithNever {
  value: never | string;
}

@route("/a")
@post
op a(@body body: ClosedFirst): void;

@route("/b")
@post
op b(@body body: ClosedLast): void;

@route("/c")
@post
op c(@body body: UnionWithNever): void;
