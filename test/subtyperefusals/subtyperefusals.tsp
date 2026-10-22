import "@typespec/http";

using Http;

/**
 * **Subtypes no dispatch can hold, and a template instance a sealed base refuses.** Each is refused
 * as an error; see `subtyperefusals.test.ts`.
 */
@service(#{ title: "Subtype refusals" })
namespace SubtypeRefusals;

/** A value the base's own declaration refuses: no value is a `Cobra`. */
@discriminator("kind")
model Snake {
  @maxLength(3) kind: string;
  length: int32;
}

model Cobra extends Snake {
  kind: "cobra";
}

model Asp extends Snake {
  kind: "asp";
}

/** A base that publishes its discriminator as an integer, under a subtype fixing a string. */
@discriminator("kind")
model Coded {
  @encode("x", int32) kind: string;
  name: string;
}

model CodedA extends Coded {
  kind: "a";
}

/** A discriminator that is not one fixed value. */
@discriminator("kind")
model Dog {
  kind: string;
  weight: int32;
}

model Lab extends Dog {
  kind: "lab" | string;
  colour: string;
}

model Golden extends Dog {
  kind: "golden";
}

/** A subtype renaming its discriminator, so the `kind` it publishes is its base's open string. */
@discriminator("kind")
model Bird {
  kind: string;
  wingspan: int32;
}

model Eagle extends Bird {
  @encodedName("application/json", "k") kind: "eagle";
  talons: int32;
}

/** A nested base whose own `kind` is open. */
@discriminator("kind")
model Fish {
  kind: string;
  age: int32;
}

@discriminator("sharktype")
model Shark extends Fish {
  kind: "shark" | string;
  sharktype: string;
}

model SawShark extends Shark {
  sharktype: "saw";
}

model Salmon extends Fish {
  kind: "salmon";
}

/** A template instance extending a base openapi3 seals, because it does not count the instance. */
model Plant {
  name: string;
}

model Potted<T> extends Plant {
  pot: T;
}

model Holder {
  plant: Potted<string>;
}

/** A discriminator typed as a union holding a scalar whose base constrains it. */
@maxLength(3)
scalar K1 extends string;

scalar K2 extends K1;

@discriminator("kind")
model Adder {
  kind: K2 | null;
  n: int32;
}

model Viper extends Adder {
  kind: "viper";
}

/** One template instantiated twice on a sealed base: two declarations, two refusals. */
model Weed {
  name: string;
}

model Twice<T> extends Weed {
  extra: T;
}

model Patch {
  a: Twice<string>;
  b: Twice<int32>;
}

/** A `@discriminated` variant inheriting an open discriminator, and one renaming it. */
model AnimalN {
  type: string;
  name: string;
}

model CatN {
  type: "cat";
  name: string;
}

model DogN extends AnimalN {
  bark: boolean;
}

@discriminated(#{ envelope: "none", discriminatorPropertyName: "type" })
union PetN {
  cat: CatN,
  dog: DogN,
}

model BirdN {
  @encodedName("application/json", "t") type: "bird";
  wings: int32;
}

@discriminated(#{ envelope: "none", discriminatorPropertyName: "type" })
union FlyN {
  cat: CatN,
  bird: BirdN,
}

/**
 * A model overridden by an unrelated one it is assignable to, which lacks its constraint: the value
 * is held to both, and merged key by key - the base's `@maxLength(2)` applies.
 */
model Meta {
  @maxLength(2) tag: string;
}

model Meta2 {
  tag: string;
}

model Tagged {
  meta: Meta;
}

model TaggedX extends Tagged {
  meta: Meta2;
}

/** A subtype under a subtype no value is, itself a base: no value is either. */
@discriminator("sub")
model Krait extends Snake {
  kind: "krait";
  sub: string;
}

model King extends Krait {
  sub: "king";
  crown: int32;
}

/**
 * Two unrelated models with a default each, one redeclared over the other: merged key by key, the
 * redeclaration's default filled, where their intersection threw "Unmergable intersection" on every
 * parse.
 */
model MetaE {
  tag: string;
  level?: int32 = 2;
}

model MetaD {
  tag: string;
  level?: int32 = 1;
}

model Keeper {
  meta: MetaE;
}

model KeeperX extends Keeper {
  meta: MetaD;
}

/**
 * A `@discriminated` variant fixing a value its base's constraint refuses: no value is one, and the
 * union is the rest.
 */
model Steed {
  @maxLength(5) type: string;
  name: string;
}

model Horse extends Steed {
  type: "horsey";
}

@discriminated(#{ envelope: "none", discriminatorPropertyName: "type" })
union Farm {
  cat: CatN,
  horsey: Horse,
}

/**
 * Variants a sealed base leaves no value of, beside one it does: the union is the one, where a
 * `z.never()` in the dispatch threw "Invalid discriminated union option" on every parse.
 */
model Lid {
  @maxLength(1) kind: string;
}

model Capped<K extends string> extends Lid {
  kind: K;
  cap: string;
}

model Plain {
  kind: "b";
  v: string;
}

@discriminated(#{ envelope: "none" })
union Jars {
  a: Capped<"a">,
  b: Plain,
  c: Capped<"c">,
}

/** Two unrelated recursive models merged: the merge refers back to itself. */
model NodeA {
  x: string;
  child?: NodeA;
}

model NodeB {
  x: string;
  child?: NodeB;
}

model Rooted {
  n: NodeA;
}

model RootedX extends Rooted {
  @encodedName("application/json", "n") n2: NodeB;
}

/** The same through two envelopes, whose `value` no declaration states: refused all the same. */
model CatR {
  meow: boolean;
  p?: PetsR;
}

model CatR2 {
  meow: boolean;
  p?: PetsR2;
}

@discriminated
union PetsR {
  cat: CatR,
}

@discriminated
union PetsR2 {
  cat: CatR2,
}

model Kennel {
  p: PetsR;
}

model KennelX extends Kennel {
  @encodedName("application/json", "p") p2: PetsR2;
}

@route("/kennel") @post op kennel(@body body: KennelX): void;
@route("/jars") @post op jars(@body body: Jars): void;
@route("/rooted") @post op rooted(@body body: RootedX): void;
@route("/snake") @post op snake(@body body: Snake): void;
@route("/king") @post op king(@body body: King): void;
@route("/keeper") @post op keeper(@body body: KeeperX): void;
@route("/farm") @post op farm(@body body: Farm): void;
@route("/tagged") @post op tagged(@body body: TaggedX): void;
@route("/cobra") @post op cobra(@body body: Cobra): void;
@route("/adder") @post op adder(@body body: Adder): void;
@route("/patch") @post op patch(@body body: Patch): void;
@route("/petn") @post op petN(@body body: PetN): void;
@route("/flyn") @post op flyN(@body body: FlyN): void;
@route("/coded") @post op coded(@body body: Coded): void;
@route("/dog") @post op dog(@body body: Dog): void;
@route("/bird") @post op bird(@body body: Bird): void;
@route("/fish") @post op fish(@body body: Fish): void;
@route("/holder") @post op holder(@body body: Holder): void;
