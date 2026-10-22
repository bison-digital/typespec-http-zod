import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r14" })
namespace R14;
model M2 { b: numeric }
model M1 { @visibility(Lifecycle.Create) a: M2; }
model M3 { @visibility(Lifecycle.Create) a?: int32; c: int32[]; ...Record<unknown>; }
@oneOf union O1 { v0: M1, v1: M3 }
model RootB { u: O1 }
model LeafB extends RootB { u: M1 }
@route("/c1") @post op c1(@body body: LeafB): LeafB;
@route("/c1") @patch(#{ implicitOptionality: true }) op p1(@body body: LeafB): void;
