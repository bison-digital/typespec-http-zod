import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "fB" }) namespace FB;
model A { x?: string }
model B { y?: string }
@discriminated union DU { a: A, b: B }
model Root { k?: DU; q: int32 }
model Mid extends Root { k?: Record<string> }
@route("/p") @patch(#{ implicitOptionality: true }) op p(@body body: Mid): void;
