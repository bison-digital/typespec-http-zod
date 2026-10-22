import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "x12" }) namespace X12;
@discriminator("kind") model P { @visibility(Lifecycle.Read) kind: string; name: string; @visibility(Lifecycle.Create) pw?: string }
model C extends P { kind: "c"; c?: int32 }
model D extends P { @visibility(Lifecycle.Read) kind: "d"; d?: int32 }
@discriminator("kind") model Q { kind: string; name: string; @visibility(Lifecycle.Create) pw?: string }
model QC extends Q { @visibility(Lifecycle.Read) kind: "qc"; c?: int32 }
model QD extends Q { kind: "qd"; d?: int32 }
@route("/p") @post op cp(@body body: P): P;
@route("/q") @post op cq(@body body: Q): Q;
@route("/q") @patch(#{ implicitOptionality: true }) op uq(@body body: Q): void;
