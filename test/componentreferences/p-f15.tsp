import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F15" })
namespace F15;

// A: a @discriminator base whose subtype a create body reaches first (split, refused).
@discriminator("kind")
model Pet {
  kind: string;
}
model Cat extends Pet {
  kind: "cat";
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterA {
  @visibility(Lifecycle.Create) secret: string;
  cat: Cat;
}
@route("/a") @post op createA(@body body: OuterA): void;
@route("/a") @get op readPet(): Pet;

// B: an envelope-less @discriminated union whose variant a create body reaches first.
model CatB {
  kind: "cat";
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model DogB {
  kind: "dog";
  name: string;
}
@discriminated(#{ envelope: "none" })
union PetB {
  cat: CatB,
  dog: DogB,
}
model OuterB {
  @visibility(Lifecycle.Create) secret: string;
  cat: CatB;
}
@route("/b") @post op createB(@body body: OuterB): void;
@route("/b") @get op readPetB(): PetB;
