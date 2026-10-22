import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r01" })
namespace R01;
enum Color { red, green }
model M6 { e: Color }
model M7 { @maxLength(3) e: string }
@discriminated union DU { y: M6, z: M7 }
model R { d: DU | string }
model S extends R { d: DU }
@route("/s") @post op s(@body body: S): void;
