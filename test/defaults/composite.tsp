import "@typespec/http";

using Http;

/**
 * Composite default values, which this emitter refused until it was measured.
 *
 * `@typespec/openapi3` publishes every one of these as a `default` keyword - arrays, objects and
 * nested arrays alike - so a spec carrying them is representable by the reference implementation.
 * Refusing them here made the same spec representable by one emitter and not the other, which is the
 * one thing a differential between the two cannot tolerate.
 */
@service(#{ title: "composite defaults" })
namespace CompositeDefaults;

model Inner {
  x: int32;
  label: string;
}

model Row {
  /** A populated array literal. */
  tags?: string[] = #["a", "b"];

  /** An object literal, published by openapi3 as `default: {"x":1,"label":"hi"}`. */
  inner?: Inner = #{ x: 1, label: "hi" };

  /** Nesting, so a renderer that only handles one level is caught. */
  nested?: string[][] = #[#["p"], #["q"]];

  /** The empty case, which was always supported and must stay that way. */
  empty?: string[] = #[];

  /** A scalar default beside them, for the same reason. */
  count?: int32 = 3;
}

@route("/rows")
@post
op addRow(@body body: Row): Row;
