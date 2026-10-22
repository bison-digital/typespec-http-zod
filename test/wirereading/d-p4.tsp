import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "p4" })
namespace P4;
@discriminator("kind") model Pet { @encodedName("application/json", "type") kind: string; name: string }
model Cat extends Pet { kind: "cat"; meow?: int32 }
model Dog extends Pet { @encodedName("application/json", "type") kind: "dog" }
@route("/a") @post op a(@body body: Pet): Pet;
