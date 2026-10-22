import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "vt2" }) namespace Vt2;
model B { name: string; @visibility(Lifecycle.Create) pw: string }
@discriminator("kind") model Pet { kind: string; x?: B }
model Cat extends Pet { kind: "cat"; meow?: int32 }
@route("/p") @post op cp(@body body: Create<Pet>): Pet;
