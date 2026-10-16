import "@typespec/http";

using Http;

/**
 * `@discriminator` bases, in the shapes that decide whether polymorphism is validated at all.
 *
 * A discriminated base is a **choice** between its subtypes, and its own shape for a value naming
 * none of them. Emitted as its own properties alone it becomes `z.object({kind: z.string(), ...})`,
 * which accepts `{kind: "eagle"}` while checking nothing `Eagle` declares - a polymorphic endpoint
 * validating none of its polymorphism.
 */
@service(#{ title: "polymorphism" })
namespace Polymorphism;

@discriminator("kind")
model Bird {
  kind: string;
  wingspan: int32;
}

model Sparrow extends Bird {
  kind: "sparrow";
}

/**
 * The case that decides whether polymorphism and recursion can coexist: a subtype referring back to
 * the union it belongs to. The union reads each option's discriminator at construction time, so if
 * that read enumerated the whole shape it would fire this getter before the union exists.
 */
model Eagle extends Bird {
  kind: "eagle";
  friends?: Bird[];
  partner?: Bird;
}

/** Two levels: a subtype that is itself a discriminated base. */
@discriminator("kind")
model Fish {
  kind: string;
  age: int32;
}

@discriminator("sharktype")
model Shark extends Fish {
  kind: "shark";
  sharktype: string;
}

model SawShark extends Shark {
  sharktype: "saw";
}

model GoblinShark extends Shark {
  sharktype: "goblin";
}

model Salmon extends Fish {
  kind: "salmon";
  friends?: Fish[];
}

/**
 * A discriminator nobody extends. openapi3 emits an ordinary object with no `mapping`, and a union
 * over zero options would validate nothing - so this must stay a plain object.
 */
@discriminator("kind")
model Reptile {
  kind: string;
  scales: int32;
}

/**
 * A closed discriminator every member of which a subtype claims. A value outside it is refused by the
 * base's own `kind`, so there is no value left for the base to accept.
 */
enum SnakeKind {
  Cobra: "cobra",
}

@discriminator("kind")
model Snake {
  kind: SnakeKind;
  length: int32;
}

model Cobra extends Snake {
  kind: SnakeKind.Cobra;
}

/** A closed discriminator with a member no subtype claims: a value naming it is the base's. */
enum PetKind {
  Dog: "dog",
  Cat: "cat",
}

@discriminator("kind")
model Pet {
  kind: PetKind;
  name: string;
}

model Dog extends Pet {
  kind: PetKind.Dog;
  barks: boolean;
}

@route("/bird") op bird(@body body: Bird): Bird;
@route("/snake") op snake(@body body: Snake): Snake;
@route("/pet") op pet(@body body: Pet): Pet;
@route("/fish") op fish(@body body: Fish): Fish;
@route("/reptile") op reptile(@body body: Reptile): Reptile;
