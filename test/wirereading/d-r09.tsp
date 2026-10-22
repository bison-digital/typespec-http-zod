import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r09" })
namespace R09;
model In { x: string; @visibility(Lifecycle.Create, Lifecycle.Read) c?: string }
model A { a?: In }
model B { a?: In }
model Bs is B[];
model R { u: A[] }
model S extends R { u: Bs }
@route("/s") @patch(#{ implicitOptionality: true }) op p(@body body: S): void;
@route("/s") @post op c(@body body: S): S;
