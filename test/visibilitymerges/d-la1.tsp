import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "la1" }) namespace La1;
model Inner { @visibility(Lifecycle.Read) c: boolean }
model El { e: Inner; @visibility(Lifecycle.Create) b?: string }
model Els is El[];
model Base { u: Els }
model Sub extends Base { u: El[] }
model Base2 { u: El[] }
model Sub2 extends Base2 { u: Els }
@route("/s") @post op c(@body body: Sub): Sub;
@route("/s") @patch(#{ implicitOptionality: true }) op p(@body body: Sub): void;
@route("/s2") @post op c2(@body body: Sub2): Sub2;
@route("/s2") @patch(#{ implicitOptionality: true }) op p2(@body body: Sub2): void;
