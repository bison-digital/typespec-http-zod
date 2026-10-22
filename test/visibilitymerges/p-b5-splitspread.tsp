import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "B5" })
namespace B5;

model Inner {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model Outer {
  @visibility(Lifecycle.Create) secret: string;
  inner: Inner;
}
model Holder {
  i: { ...Inner };
}
@route("/o") @post op create(@body body: Outer): void;
@route("/h") @get op getHolder(): Holder;
