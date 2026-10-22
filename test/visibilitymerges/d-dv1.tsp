import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "dv1" }) namespace Dv1;
@discriminator("kind") model Pet { @visibility(Lifecycle.Read) kind: string; @visibility(Lifecycle.Create) pw?: string; name: string }
model Cat extends Pet { kind: "cat"; meow?: int32 }
model Dog extends Pet { @visibility(Lifecycle.Read) kind: "dog"; bark?: boolean }
@route("/p") @post op p(@body body: Pet): Pet;
