import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r03" })
namespace R03;
model A { x: string; k?: int32 = 1 }
model B { y: int32 }
model C { x: string; z?: boolean; k?: int32 = 2 }
@oneOf union O { v0: A | B, v1: string }
model R { p: O }
model S extends R { p: C }
@route("/s") @post op s(@body body: S): void;
