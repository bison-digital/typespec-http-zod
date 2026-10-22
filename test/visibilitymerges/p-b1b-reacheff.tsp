import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "B1b" })
namespace B1b;

model Foo {
  @visibility(Lifecycle.Create) secret: string;
  name: string;
}
model U {
  x: { ...Foo };
}
@route("/f") @post op create(@body body: Foo): void;
@route("/u") @get op getU(): U;
