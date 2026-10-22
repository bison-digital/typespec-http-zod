import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "cy3" }) namespace Cy3;
model Node { kind: "node"; kids?: TreeN[]; ...Record<string | TreeN[]> }
model Leaf { kind: "leaf"; v: int32 }
@discriminated(#{ envelope: "none" }) union TreeN { node: Node, leaf: Leaf }
@route("/s") @post op s(@body body: TreeN): void;
