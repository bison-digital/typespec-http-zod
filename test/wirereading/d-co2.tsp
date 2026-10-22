import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "co2" })
namespace Co2;
model Thing { a: string; @visibility(Lifecycle.Create) c?: string }
model ThingCreate { z: int32 }
@route("/a") @post op a(@body body: Thing): Thing;
@route("/b") @post op b(@body body: ThingCreate): void;
