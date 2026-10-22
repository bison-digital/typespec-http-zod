import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r07" })
namespace R07;
@oneOf union O1 { v0: "b", v1: string }
@oneOf union O2 { v0: "b", v1: string }
model R { e: O1 }
model S extends R { e: O2 }
@route("/s") @post op s(@body body: S): void;
