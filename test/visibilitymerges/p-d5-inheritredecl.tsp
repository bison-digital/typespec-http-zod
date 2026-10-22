import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "D5" })
namespace D5;

model B {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model D extends B {
  id: string;
  extra: string;
}
model Outer {
  @visibility(Lifecycle.Create) secret: string;
  b: B;
}
@route("/o") @post op create(@body body: Outer): void;
@route("/d") @get op get(): D;
