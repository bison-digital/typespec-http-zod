import "@typespec/http";

using Http;

/**
 * **Overrides and discriminators where the document's `allOf` decides what a value is.** See
 * `inheritanceedges.test.ts`, which grades each against the document.
 */
@service(#{ title: "Inheritance edges" })
namespace InheritanceEdges;

/** A subtype adding an encoding to an inherited property: an integer and a string at once. */
model Ev {
  n: int32;
  when: utcDateTime;
}

model EvN extends Ev {
  @encode(string) n: int32;
}

model EvW extends Ev {
  @encode(DateTimeKnownEncoding.unixTimestamp, int32) when: utcDateTime;
}

/** A list overriding a constrained list of its element's base, and of a wider element. */
model Animal {
  name: string;
}

model Dog extends Animal {
  barks: boolean;
}

model Kennel {
  @maxItems(2) dogs?: Animal[];
}

model DogKennel extends Kennel {
  dogs?: Dog[];
}

model Letters {
  @maxItems(2) letters: string[];
}

model Ab extends Letters {
  letters: ("a" | "b")[];
}

/** A property renamed onto the wire name of another inherited property. */
model Toy {
  name: string;
}

model Plain {
  b: int32;
  t: Toy;
}

model PlainSub extends Plain {
  @encodedName("application/json", "b") a: string;
}

model ToySub extends Plain {
  @encodedName("application/json", "t") s: string;
}

/** A union holding a constrained scalar, overridden by a literal it refuses. */
@maxLength(3)
scalar Short extends string;

scalar Short2 extends Short;

model Coded {
  code: Short2 | null;
}

model CodedX extends Coded {
  code: "abcdefgh";
}

/** A discriminator declared `never`: openapi3 drops it and adds a required string. */
@discriminator("kind")
model NeverKind {
  kind: never;
  name: string;
}

/** A discriminator declared above the model naming it, as an integer, beside the string it adds. */
model Root {
  kind: int32;
  name: string;
}

@discriminator("kind")
model Rooted extends Root {}

/** A template instance adding only an optional property to a base openapi3 seals. */
model Plant {
  name: string;
}

model Opt<T> extends Plant {
  extra?: T;
}

model OptHolder {
  plant: Opt<string>;
}

/** A union ancestor narrowed to one member: its keywords apply only where they apply to that type. */
model Mixed {
  @maxLength(3) a: string | int32;
  @minValue(5) b: string | int32;
}

model MixedX extends Mixed {
  a: int32;
  b: string;
}

/** A list ancestor narrowed to its element. */
model Multi {
  v?: string[] | string;
}

model MultiX extends Multi {
  v?: string;
}

/** A derived scalar that widens its base's constraint: the base's still applies, alone and listed. */
@maxLength(3)
scalar Narrow extends string;

@maxLength(10)
scalar Wide extends Narrow;

model WB {
  w: Narrow;
  ws: Narrow[];
}

model WX extends WB {
  w: Wide;
  ws: Wide[];
}

/** A record of what narrows the ancestor's record's values. */
model RB {
  r: Record<numeric>;
}

model RX extends RB {
  r: Record<int32>;
}

/** An optional rename onto a key an ancestor requires: still required. */
model RenB {
  t: string;
}

model RenX extends RenB {
  @encodedName("application/json", "t") s?: string;
}

/** A union discriminator above the model naming it, beside the string openapi3 adds. */
model Root2 {
  kind: int32 | string;
  name: string;
}

@discriminator("kind")
model Rooted2 extends Root2 {}

/** A discriminator base redeclaring `kind` under a constrained one: the constraint still applies. */
model Root3 {
  @maxLength(3) kind: string;
  name: string;
}

@discriminator("kind")
model Base3 extends Root3 {
  kind: string;
}

/** A date bound on an encoded ancestor, which an encoded override keeps. */
model E {
  @encode(DateTimeKnownEncoding.unixTimestamp, int32)
  @minValue(utcDateTime.fromISO("2020-01-01T00:00:00Z"))
  at: utcDateTime;
}

model EX extends E {
  @encode(DateTimeKnownEncoding.unixTimestamp, int32) at: utcDateTime;
}

/** An envelope-less discriminated union whose variant fixes an inherited scalar discriminator. */
scalar Kind extends string;

model Shaped {
  type: Kind;
}

model Sq extends Shaped {
  type: "sq";
  side: int32;
}

model Ci extends Shaped {
  type: "ci";
  radius: int32;
}

@discriminated(#{ envelope: "none", discriminatorPropertyName: "type" })
union Fig {
  sq: Sq,
  ci: Ci,
}

/**
 * A `@header` ancestor inside a body, which `@typespec/http` ignores there, so openapi3 publishes it
 * as a property - with its constraint.
 */
model HBase {
  @header("x-code") @maxLength(3) code: string;
  name: string;
}

model HSub extends HBase {
  code: string;
}

@route("/hsub") @post op hsub(@body body: HSub): void;
@route("/mixed") @post op mixed(@body body: MixedX): void;
@route("/multi") @post op multi(@body body: MultiX): void;
@route("/wx") @post op wx(@body body: WX): void;
@route("/rx") @post op rx(@body body: RX): void;
@route("/renx") @post op renx(@body body: RenX): void;
@route("/rooted2") @post op rooted2(@body body: Rooted2): void;
@route("/base3") @post op base3(@body body: Base3): void;
@route("/ex") @post op ex(@body body: EX): void;
@route("/fig") @post op fig(@body body: Fig): void;
@route("/ev") @post op ev(@body body: Ev): void;
@route("/evn") @post op evn(@body body: EvN): void;
@route("/evw") @post op evw(@body body: EvW): void;
@route("/kennel") @post op kennel(@body body: DogKennel): void;
@route("/ab") @post op ab(@body body: Ab): void;
@route("/plainsub") @post op plainSub(@body body: PlainSub): void;
@route("/toysub") @post op toySub(@body body: ToySub): void;
@route("/coded") @post op coded(@body body: Coded): void;
@route("/codedx") @post op codedX(@body body: CodedX): void;
@route("/neverkind") @post op neverKind(@body body: NeverKind): void;
@route("/rooted") @post op rooted(@body body: Rooted): void;
@route("/opt") @post op opt(@body body: OptHolder): void;
