import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "tu3" }) namespace Tu3;
model El { e: string; @visibility(Lifecycle.Create) b?: string }
model H { o: El; t: [El, string] }
@route("/s") @post op c(@body body: H): H;
@route("/s") @patch(#{ implicitOptionality: true }) op p(@body body: H): void;
