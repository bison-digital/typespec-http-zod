import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r08" })
namespace R08;
model V1 { a: string }
model V2 { b: int32 }
@discriminated union E { v1: V1, v2: V2 }
@discriminated union E2 { v1: V1, v2: V2 }
model G0 { g: E2 | string }
model G1 extends G0 { g: E }
@route("/g") @post op cg(@body body: G1): G1;
@route("/g") @patch(#{ implicitOptionality: true }) op pg(@body body: G1): void;
