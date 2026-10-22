import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";

using Http;
using OpenAPI;

@service(#{ title: "B7" })
namespace B7;

model Inner {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model Outer {
  @visibility(Lifecycle.Create) secret: string;
  inner: Inner;
}
@route("/a") @get op a(@useRef("other.json#/components/parameters/I") @header inner: Inner): void;
@route("/b") @post op b(@body body: Outer): void;
@route("/c") @get op c(): Inner;
