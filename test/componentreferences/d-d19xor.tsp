import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "d19" })
namespace D19;

@oneOf union O1 { v0: int32 | float, v1: string }
@oneOf union O2 { v0: int32, v1: "abcd" }
model Base { q: O1 }
model Sub extends Base { q: O2 }

@oneOf union O3 { one: 1, any: unknown }
model M6 { c?: O3 }
model S10 { c?: 1 }
model Base2 { u: M6 }
model Sub2 extends Base2 { u: S10 }

@route("/s") @post op s(@body body: Sub): void;
@route("/s2") @post op s2(@body body: Sub2): void;
