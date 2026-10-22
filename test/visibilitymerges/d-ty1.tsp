import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "ty1" }) namespace Ty1;
@oneOf union Nothing { a: unknown, b: unknown }
@oneOf union NonNull { a: unknown, b: null }
model Base { x?: Nothing }
model Sub extends Base { x?: unknown }
model Base2 { x: NonNull }
model Sub2 extends Base2 { x: unknown }
model A { x?: Nothing; y: string }
model B { x?: unknown; y: string; z?: int32 }
model Base3 { m: B }
model Sub3 extends Base3 { m: A }
@route("/s") @post op s(@body body: Sub): Sub;
@route("/s2") @post op s2(@body body: Sub2): Sub2;
@route("/s3") @post op s3(@body body: Sub3): Sub3;
// Beside a typed declaration: no string is one member of `Nothing` only, and `NonNull` refuses `null`.
model Base4 { x: Nothing }
model Sub4 extends Base4 { x: string }
model Base5 { x: NonNull }
model Sub5 extends Base5 { x: string | null }
model Base6 { x: NonNull }
model Sub6 extends Base6 { x: null }
@route("/s4") @post op s4(@body body: Sub4): Sub4;
@route("/s5") @post op s5(@body body: Sub5): Sub5;
@route("/s6") @post op s6(@body body: Sub6): Sub6;
