import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "un1" }) namespace Un1;
scalar Free;
@oneOf union U1 { a: unknown, b: null }
@oneOf union U2 { a: string | null, b: null }
@oneOf union U3 { a: string | null, b: int32 | null }
@oneOf union U4 { a: Free, b: null }
@oneOf union U5 { a: unknown, b: string, c: null }
@oneOf union U7 { a: "x", b: null, c: null }
@oneOf union U8 { a: Free, b: unknown }
@oneOf union U9 { a: Free, b: int32 }
model H { @oneOf p1: unknown | null; @oneOf p2?: string | null | null; p3: U1; p4: U2 | string; p5: U5[] }
@route("/h") @post op h(@body body: H): H;
