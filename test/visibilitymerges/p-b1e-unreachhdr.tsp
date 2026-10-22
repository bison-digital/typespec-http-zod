import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "B1e" })
namespace B1e;

model Foo {
  @visibility(Lifecycle.Create) secret: string;
  name: string;
}
model U {
  x: { ...Foo; @header h: string };
}
@route("/f") @post op create(@body body: Foo): void;
