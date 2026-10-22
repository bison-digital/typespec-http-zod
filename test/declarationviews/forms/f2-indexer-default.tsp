import "@typespec/http";
using Http;

/**
 * Object defaults that set a declared key whose type the model's indexer refuses. Zod types such a
 * model with the indexer over every key, declared ones included, so no object literal setting the
 * key is a value of it.
 */
@service(#{ title: "Indexer defaults" })
namespace IndexerDefaults;

model ObjIdx {
  s?: string;
  ...Record<int32>;
}
model R2 {
  ...Record<string>;
  n?: int32;
}
model Wrap {
  o?: ObjIdx;
}
model B {
  r?: ObjIdx = #{ s: "x" };
  r2?: R2 = #{ n: 1 };
  l?: ObjIdx[] = #[#{ s: "y", k: 2 }];
  w?: Wrap = #{ o: #{ s: "z" } };
  /** Sets only keys the indexer holds, so the literal is a value of the type. */
  plain?: ObjIdx = #{ k: 1 };
}

@route("/b") @post op b(@body body: B): void;
@route("/h") @post op h(@header(#{ explode: true }) x?: ObjIdx = #{ k: 1, s: "x" }): void;
