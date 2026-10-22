import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "B6" })
namespace B6;

model Foo {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model Holder {
  @visibility(Lifecycle.Create) s: string;
  f: { ...Foo };
}
@route("/foo") @get op getFoo(): Foo;
@route("/h") @post op create(@body body: Holder): void;
