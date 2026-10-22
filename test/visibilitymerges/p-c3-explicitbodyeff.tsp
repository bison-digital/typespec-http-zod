import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "C3" })
namespace C3;

model Foo {
  name: string;
}
@route("/f") @post op create(@body body: { ...Foo; @header h: string }): void;
@route("/f") @get op get(): Foo;
