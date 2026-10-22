import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r06" })
namespace R06;
@oneOf union DupN { a: 1, b: 1, c: string }
@oneOf union DupS { a: "x", b: "x", c: 5 }
@oneOf union DupB { a: true, b: true, c: int32 }
model H { n: DupN; s: DupS; b: DupB }
@route("/h") @post op h(@body body: H): void;
model R6 { p: DupN }
model S6 extends R6 { p: 1 }
@route("/s6") @post op s6(@body body: S6): void;
