import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "B4" })
namespace B4;

@friendlyName("Bar")
model Foo {
  name: string;
}
@route("/f") @post op create(...Foo): void;
