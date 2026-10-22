import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "vt3" }) namespace Vt3;
model B { name: string; @visibility(Lifecycle.Create) pw: string }
@discriminator("kind") model Pet { kind: string; x?: B }
model Cat extends Pet { kind: "cat"; meow?: int32 }
@route("/p") @post op cp(@body body: Pet): Pet;
@route("/u") @patch op up(@body body: Update<Pet>): Pet;
@route("/q") @put op cu(@body body: CreateOrUpdate<Pet>): Pet;
