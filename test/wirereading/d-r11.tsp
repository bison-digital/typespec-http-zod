import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r11" })
namespace R11;
model M8 { b: float }
model M9 { a: string }
@discriminated(#{ discriminatorPropertyName: "kind" }) union DU { x: M8, y: M9 }
@oneOf union O1 { v0: unknown, v1: string }
model A { e?: O1 }
model B { e?: DU }
model C { e?: DU }
model R { m: A | B }
model S extends R { m: C }
@route("/s") @post op s(@body body: S): void;
