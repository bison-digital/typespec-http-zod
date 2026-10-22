import "@typespec/http";
using Http;
@service(#{ title: "d20" })
namespace D20;

model V3 { a?: boolean }
model V4 { a: int32 }
@discriminated(#{ discriminatorPropertyName: "kind" }) union E2 { v0: V3, v1: V4 }
model H { b: E2 }
@route("/h") @post op create(@body body: H): H;
@route("/h") @patch(#{ implicitOptionality: true }) op update(@body body: H): void;
