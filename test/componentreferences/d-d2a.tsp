import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "d2" })
namespace D2;

model A { a?: string }
model B { b?: string }
model C { c: int32 }
@oneOf union Inner { a: A, b: B }
union Outer { i: Inner, c: C }

model Base1 { u: Outer }
model Sub1 extends Base1 { u: A }

model Base2 { u: Inner | C }
model Sub2 extends Base2 { u: A | C }

@oneOf union Lits { a: "x", b: "x" | "y" }
model Base3 { u: Lits }
model Sub3 extends Base3 { u: "x" }


@route("/s1") @post op s1(@body body: Sub1): void;
@route("/s2") @post op s2(@body body: Sub2): void;
@route("/s3") @post op s3(@body body: Sub3): void;
@route("/b1") @post op b1(@body body: Base1): void;
