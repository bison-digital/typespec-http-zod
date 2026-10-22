import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "p3" }) namespace P3;
enum PetKind { cat, dog }
@discriminator("kind") model Pet { @visibility(Lifecycle.Read) kind: PetKind; name: string; }
model Cat extends Pet { kind: PetKind.cat; meow?: string; }
model Outer { @visibility(Lifecycle.Create) secret: string; pet: Pet; }
@route("/o") @post op create(@body body: Outer): void;
@route("/p") @get op get(): Pet;
