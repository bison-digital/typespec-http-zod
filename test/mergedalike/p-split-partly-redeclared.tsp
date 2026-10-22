import "@typespec/http";
using Http;

/**
 * `B` is first reached from a `PUT` body, where openapi3 reads its properties at `CreateOrUpdate` and
 * its `required` at `Read`: it requires `k` and `bid` and declares neither. `S` declares `k` itself,
 * and not `bid`, so every view of `S` holds `B` through `allOf` - split.
 */
@service(#{ title: "Split partly redeclared" })
namespace SplitPartly;

model B {
  name: string;
  @visibility(Lifecycle.Read) k: string;
  @visibility(Lifecycle.Read) bid: string;
}
model S extends B {
  @visibility(Lifecycle.Create) k: string;
}
@route("/o0") @put op p0(@body body: S): void;
@route("/o1") @post op c1(@body body: S): void;
