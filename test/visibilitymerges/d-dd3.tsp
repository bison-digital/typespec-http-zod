import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "dd3" }) namespace Dd3;
@discriminator("breed") model Cat { kind: "cat"; breed: string }
model Siamese extends Cat { breed: "siamese" }
model Dog { kind: "dog" }
@discriminated(#{ envelope: "none" }) union Pet { cat: Cat, dog: Dog }
@route("/p") @post op p(@body body: Pet): void;
