import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "x32" }) namespace X32;
@oneOf union OW { a: 300, b: int32 }
@oneOf union OD { a: "red", b: string }
model Root { g: uint8; h: utcDateTime }
model Leaf extends Root {
  @encodedName("application/json", "g") gg: OW;
  @encodedName("application/json", "h") hh: OD;
}
@route("/l") @post op c(@body body: Leaf): void;
