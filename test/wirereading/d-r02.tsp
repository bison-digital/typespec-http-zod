import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r02" })
namespace R02;
@discriminator("kind") model Pet { kind: string; name: string }
model Dog extends Pet { kind: "dog"; @visibility(Lifecycle.Create) pw?: string }
model Cat extends Pet { kind: "cat" }
@route("/ping") @get op ping(): void;
