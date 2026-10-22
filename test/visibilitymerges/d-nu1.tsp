import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "nu1" }) namespace Nu1;
@maxLength(2) scalar Short extends string;
enum Color { red, green }
model A { k: string }
model B { k: "green" | Short }
model C { @maxLength(3) k: string }
model Base { x: B | C }
model Sub extends Base { x: A }
model B2 { k: Color | Short }
model Base2 { x: B2 | C }
model Sub2 extends Base2 { x: A }
model Base3 { k: "green" | Short | int8 }
model Sub3 extends Base3 { @encodedName("application/json", "k") l: string }
@route("/s") @post op s(@body body: Sub): Sub;
@route("/s2") @post op s2(@body body: Sub2): Sub2;
@route("/s3") @post op s3(@body body: Sub3): Sub3;
