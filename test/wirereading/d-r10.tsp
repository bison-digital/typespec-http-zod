import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r10" })
namespace R10;
model HBase { @header("x-code") @maxLength(3) code?: string; name: string }
model HSub extends HBase { extra?: int32 }
@route("/a") @post op a(...HSub): void;
@route("/b") @post op b(@body body: HSub): void;
