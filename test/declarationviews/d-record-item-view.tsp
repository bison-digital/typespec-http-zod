import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "u2" }) namespace U2;
@discriminator("kind") model M1 { kind: string; }
model V2 extends M1 { kind: "p" }
model M4 { @visibility(Lifecycle.Create) b?: int32; d: string }
model RootA { p: M1; q?: Record<M4> }
@route("/c0") @patch(#{ implicitOptionality: true }) op p0(@body body: RootA): void;
@route("/c0") @post op c0(@body body: RootA): RootA;
