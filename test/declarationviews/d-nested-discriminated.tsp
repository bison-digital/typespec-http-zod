import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "x7" }) namespace X7;
model NA { kind: "a"; x?: string }
model NB { kind: "b"; y?: int32 }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union DN { a: NA, b: NB }
@discriminated union DE { a: NA, b: NB }
@oneOf union O1 { v0: boolean, v1: int8 }
@oneOf union O2 { v0: boolean, v1: int8 }
model R { q?: DN | O1; e?: DE | O1; r: string }
model L extends R { q?: DN | O2; e?: DE | O2 }
@route("/l") @patch(#{ implicitOptionality: true }) op p(@body body: L): void;
@route("/l") @post op c(@body body: L): L;
