import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "x34" }) namespace X34;
model NA { kind: "a"; x?: string }
model NB { kind: "b"; y?: int32 }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union DN { a: NA, b: NB }
model R { u: DN; r: string }
model S extends R { u: NA }
@route("/s") @patch(#{ implicitOptionality: true }) op p(@body body: S): void;
@route("/s") @post op c(@body body: S): void;
