import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "d2b" })
namespace D2b;

model A { a?: string }
model B { b?: string }
@oneOf union Inner { a: A, b: B }
model Base4 { @maxLength(5) v: Inner | string }
@route("/b4") @post op b4(@body body: Base4): void;
