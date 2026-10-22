import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "cy4" }) namespace Cy4;
@discriminator("kind") model Pet { kind: string; ...Record<string | Pet> }
model Cat extends Pet { kind: "cat"; friend?: Pet }
@route("/s") @post op s(@body body: Pet): void;
