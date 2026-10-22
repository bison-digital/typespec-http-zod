import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F5" })
namespace F5;

model InnerU1 {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterU1 {
  @visibility(Lifecycle.Create) secret: string;
  @header("x-h") hdr: string;
  inner: InnerU1;
}
@route("/u1") @post op createU1(@body body: OuterU1): void;

// No operation reaches this model: openapi3 emits it last, at All, outside an explicit body.
model UnusedU1 {
  inner: InnerU1;
}
