import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "x18" }) namespace X18;
model M3 { b?: "a"[] }
model M5 { b?: [int8, string]; d: string }
model D6 extends M5 { e?: int32 }
@oneOf union O2 { v0: M3, v1: M5 }
model RootB { u: O2 }
model LeafB extends RootB { u: D6 }
@route("/c1") @post op c1(@body body: LeafB): LeafB;
