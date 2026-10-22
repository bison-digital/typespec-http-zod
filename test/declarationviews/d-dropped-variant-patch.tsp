import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "x43" }) namespace X43;
model Base { @maxLength(3) kind: string; n?: string }
model NA extends Base { kind: "asp"; x?: string }
model NC extends Base { kind: "cobra"; z?: string }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union DN { asp: NA, cobra: NC }
model R { u: DN; r: string }
@route("/r") @patch(#{ implicitOptionality: true }) op p(@body body: R): void;
@route("/r") @post op c(@body body: R): R;
