import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";

using Http;
using OpenAPI;

@service(#{ title: "B2" })
namespace B2;

model Inner {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
@useRef("other.json#/components/schemas/Ext")
model Ext {
  inner: Inner;
}
model Outer {
  @visibility(Lifecycle.Create) secret: string;
  inner: Inner;
}
@route("/a") @get op a(): Ext;
@route("/b") @post op b(@body body: Outer): void;
@route("/c") @get op c(): Inner;
