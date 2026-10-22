import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "G1" })
namespace G1;

model B {
  b: string;
}
model D extends B {
  @visibility(Lifecycle.Create) secret: string;
}
@route("/d") @post op create(@body body: D): void;
