import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "vt5" }) namespace Vt5;
model Cat { kind: "cat"; @visibility(Lifecycle.Create) pw: string; name?: string }
model Dog { kind: "dog"; @visibility(Lifecycle.Read) id: string }
@discriminated union PetE { cat: Cat, dog: Dog }
@discriminated(#{ envelope: "none" }) union PetN { cat: Cat, dog: Dog }
@discriminator("kind") model Animal { kind: string; @visibility(Lifecycle.Create) pw?: string }
model Bird extends Animal { kind: "bird"; @visibility(Lifecycle.Create) wings: int32 }
model Holder { e: PetE; n: PetN; a?: Animal; l?: Animal[] }
@route("/c") @post op c(@body body: Create<Holder>): Holder;
@route("/u") @patch op u(@body body: Update<Holder>): Holder;
