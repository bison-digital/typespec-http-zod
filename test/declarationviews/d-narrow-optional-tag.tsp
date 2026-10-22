import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "x39" }) namespace X39;
model NA { kind?: "a"; x?: string }
model NB { kind?: "b"; y?: int32 }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union DN { a: NA, b: NB }
model R { u: DN; v: true | DN }
model S extends R { u: NA; v: true | NA }
@route("/s") @post op c(@body body: S): void;
