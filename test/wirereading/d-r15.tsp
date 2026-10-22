import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r15" })
namespace R15;
model M { q: null | null }
@route("/a") @post op a(@body body: M): void;
