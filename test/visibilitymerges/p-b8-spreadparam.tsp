import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "B8" })
namespace B8;

model Inner {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model Outer {
  @visibility(Lifecycle.Create) secret: string;
  inner: Inner;
}
@route("/o") @post op create(@body body: Outer): void;
@route("/q") @get op list(@query(#{ explode: true }) f: { ...Inner }): void;
