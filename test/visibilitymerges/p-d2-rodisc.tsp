import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "D2" })
namespace D2;

@discriminator("kind")
model Pet {
  @visibility(Lifecycle.Read) kind: string;
  name: string;
}
model Cat extends Pet {
  kind: "cat";
  meow: boolean;
}
model Outer {
  @visibility(Lifecycle.Create) secret: string;
  pet: Pet;
}
@route("/o") @post op create(@body body: Outer): void;
@route("/p") @get op get(): Pet;
