import "@typespec/http";

using Http;

/**
 * A spec carrying every construct whose behaviour under `z.compile()` had to be measured rather than
 * assumed: a constrained scalar, an optional property, a wire parameter that decodes through
 * `z.preprocess`, a dictionary, and a reference CYCLE - which emits `z.lazy()`, the one construct Zod
 * lists as uncompilable, and which names the const being defined from inside its own body.
 */
@service(#{ title: "Compiled" })
namespace Compiled;

model Node {
  @minLength(1)
  label: string;

  note?: string;

  attributes: Record<string>;

  children?: Node[];

  /**
   * The loop that closes through a named UNION, which is the only shape emitting a `z.lazy()`
   * DECLARATION rather than a getter - a union has no property for a getter to sit on. That is the
   * construct Zod lists as uncompilable and the one whose initialisation order had to be measured.
   */
  branch?: Branch;
}

union Branch {
  node: Node,
  leaf: string,
}

@route("/nodes")
@post
op create(@body body: Node, @query depth?: int32): Node;
