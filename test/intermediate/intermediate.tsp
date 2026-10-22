import "@typespec/http";

using Http;

/**
 * **A discriminated base whose subtype declares no discriminator, and whose subtype's subtype does.**
 * The compiler, and openapi3's `mapping`, look through `Mammal` to `Cat`.
 */
@service(#{ title: "Intermediate" })
namespace Intermediate;

@discriminator("kind")
model Animal {
  kind: string;
  name: string;
}

model Mammal extends Animal {
  legs: int32;
}

model Cat extends Mammal {
  kind: "cat";
  whiskers: int32;
}

model Bird extends Animal {
  kind: "bird";
  wingspan: int32;
}

@route("/animal") @post op animal(@body body: Animal): Animal;
