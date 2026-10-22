import "@typespec/http";

using Http;

/**
 * A default inside a CYCLE, which is the one place the two directions cannot both be named.
 *
 * A cyclic declaration cannot take its type from `z.infer<typeof ...>` - that is the loop - so it
 * carries a structural type written out, and the deferred declaration is annotated with it. That
 * annotation fixes BOTH of Zod's type parameters, and a defaulted property is the one construct
 * where the input and output types of a schema differ. So this fixture is what decides whether one
 * emitted type can serve both positions.
 */
@service(#{ title: "defaulted cycle" })
namespace DefaultedCycle;

model Node {
  label: string;

  /** The default, on the cycle. Optional, so the document leaves it out of `required`. */
  depth?: int32 = 0;

  branch?: Branch;
}

union Branch {
  node: Node,
  leaf: string,
}

@route("/node")
op node(@body body: Node): Node;
