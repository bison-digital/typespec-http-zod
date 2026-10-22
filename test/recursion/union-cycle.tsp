import "@typespec/http";

using Http;

/**
 * The cycle that genuinely cannot be deferred.
 *
 * A getter is what makes a recursive reference lazy, and a getter needs an object property to sit
 * on. Here the loop closes through a **named union** - `Node` -> `Branch` -> `Node` - and a union
 * declaration has no properties, so `const branchSchema = z.union([nodeSchema])` would read
 * `nodeSchema` while it is still initialising.
 *
 * This fixture exists to prove that case is *handled* rather than crashed. It used to be expected to
 * produce `typespec-http-zod/circular-model`; that diagnostic has been retired, because the emitter
 * now expresses the cycle instead of refusing it. `recursion.test.ts` asserts the compile reports
 * NOTHING and that the emitted `z.lazy()` declaration parses.
 */
@service(#{ title: "union cycle" })
namespace UnionCycle;

model Node {
  label: string;
  branch?: Branch;
}

union Branch {
  node: Node,
  leaf: string,
}

@route("/node") op node(@body body: Node): Node;
