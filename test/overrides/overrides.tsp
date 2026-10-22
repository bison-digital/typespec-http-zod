import "@typespec/http";

using Http;

/**
 * **A model as the document publishes it: `allOf` its base, keyed on the wire name.**
 *
 * Every declaration of a property along the chain still applies, and the discriminator is required
 * however it is declared. See `overrides.test.ts`, which grades each against the document.
 */
@service(#{ title: "Overrides" })
namespace Overrides;

/** A subtype redeclaring base properties without the base's constraints. */
@discriminator("kind")
model Pet {
  kind: string;
  @maxLength(3) name: string;
  @minValue(0) age: int32;
}

model Dog extends Pet {
  kind: "dog";
  name: string;
  age: int32;
  barks: boolean;
}

/** A discriminator declared optional, and one with a default: openapi3 requires both. */
@discriminator("kind")
model Loose {
  kind?: string;
  name: string;
}

model LooseA extends Loose {
  kind: "a";
}

@discriminator("kind")
model Defaulted {
  kind?: string = "d";
  name: string;
}

model DefaultedA extends Defaulted {
  kind: "a";
}

/** A base whose own discriminator property is renamed on the wire, so openapi3 adds `kind` too. */
@discriminator("kind")
model Renamed {
  @encodedName("application/json", "k") kind: string;
  name: string;
}

model RenamedA extends Renamed {
  kind: "a";
  extra: int32;
}

/** A base property renamed to the wire name a subtype's own property has. */
@discriminator("type")
model Shape {
  @encodedName("application/json", "type") kind: string;
  area: int32;
}

model Circle extends Shape {
  type: "circle";
  radius: int32;
}

/** A template instance declared as a model of its own, which openapi3 counts as derived. */
@discriminator("kind")
model Animal {
  kind: string;
  name: string;
}

model Pet2<T> extends Animal {
  kind: "pet";
  v: T;
}

model PetString is Pet2<string>;

/** A base declaring no discriminator property: openapi3 adds `kind`, and `allOf` carries it down. */
@discriminator("kind")
model Bare {
  name: string;
}

model BareMid extends Bare {
  legs: int32;
}

model BareLeaf extends BareMid {
  kind: "leaf";
}

@route("/pet") @post op pet(@body body: Pet): Pet;
@route("/baremid") @post op bareMid(@body body: BareMid): BareMid;
@route("/dog") @post op dog(@body body: Dog): Dog;
@route("/loose") @post op loose(@body body: Loose): Loose;
@route("/defaulted") @post op defaulted(@body body: Defaulted): Defaulted;
@route("/renamed") @post op renamed(@body body: Renamed): Renamed;
@route("/shape") @post op shape(@body body: Shape): Shape;
@route("/animal") @post op animal(@body body: Animal): Animal;
@route("/petstring") @post op petString(@body body: PetString): PetString;
