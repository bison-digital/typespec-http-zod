import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r04" })
namespace R04;
@maxValue(5) scalar Small extends int32;
@oneOf union B { p: int32, q: float }
@oneOf union A { x: B, y: numeric }
model R { p: A }
model S extends R { p: Small }
model S2 extends R { p: 1 }
@route("/s") @post op s(@body body: S): void;
@route("/s2") @post op s2(@body body: S2): void;
