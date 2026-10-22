import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "B1" })
namespace B1;

model Foo {
  @visibility(Lifecycle.Create) secret: string;
  name: string;
}
model U {
  x: { ...Foo };
}
@route("/f") @post op create(@body body: Foo): void;
