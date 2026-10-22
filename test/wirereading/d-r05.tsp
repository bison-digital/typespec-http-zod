import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r05" })
namespace R05;
@oneOf union O1 { v0: float | null, v1: string }
model R { p: O1 }
model S extends R { p: float | null }
@oneOf union O2 { a: int32, b: null }
union U { v0: O2, v1: string }
model R2 { q: U }
model S2 extends R2 { q: int32 | null }
@route("/s") @post op s(@body body: S): void;
@route("/s2") @post op s2(@body body: S2): void;
