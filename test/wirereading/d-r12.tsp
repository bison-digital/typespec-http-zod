import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r12" })
namespace R12;
model HBase { @header("x-code") code: string; name: string }
model HSub extends HBase { extra?: int32 }
@route("/a") @post op a(@body body: HSub): void;
@route("/b") @get op b(): HBase;
