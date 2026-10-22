import "@typespec/http";
using Http;
@service(#{ title: "d31" })
namespace D31;

model V2 { a: float }
model V3 { b: int32 }
@discriminated(#{ discriminatorPropertyName: "kind" }) union E1 { v0: V2, v1: V3 }
model RootA { q?: Record<E1> }
model LeafA extends RootA { q?: Record<V2> }
model N { q?: Record<never> }
@route("/a") @post op a(@body body: LeafA): void;
@route("/n") @post op n(@body body: N): void;
