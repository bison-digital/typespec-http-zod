import "@typespec/http";

using Http;

/**
 * Redeclared properties the document holds to every declaration of their key, through `allOf`.
 * Each was refused, crashed the module on import, or answered differently from the document.
 */
@service(#{ title: "Merged declarations" })
namespace Merged;

@maxLength(3)
scalar Short extends string;

@minLength(1)
scalar Shorter extends Short;

model Label {
  tag: string;
}

/** A nullable override of a key whose ancestor refuses `null`: the `null` is no value. */
model NullBase {
  @maxLength(3) at: string;
  v: string;
  w: string;
  @minItems(1) xs: string[];
  meta: Label;
  d?: string;
}
model NullSub extends NullBase {
  @encodedName("application/json", "at") at2: string | null;
  @encodedName("application/json", "v") v2: "a" | null;
  @encodedName("application/json", "w") w2: "a" | "b" | null;
  @encodedName("application/json", "xs") xs2: string[] | null;
  @encodedName("application/json", "meta") meta2: Label | null;

  /** Reported as `invalid-default`: the `null` it falls back to is no value of `NullBase`'s `d`. */
  @encodedName("application/json", "d") d2?: string | null = null;
}

/** A variant type over a union with an envelope, whose members are the wrappers. */
model Cat {
  meow: boolean;
}
model Dog {
  bark: boolean;
}
@discriminated
union Pets {
  cat: Cat,
  dog: Dog,
}
model PetBase {
  pet: Pets;
}
model PetSub extends PetBase {
  pet: Cat;
}

/** Lists merged element by element: a union element, a nullable one, a narrower scalar. */
model TagsBase {
  tags: Short[];
  maybe: (Short | null)[];
}
model TagsSub extends TagsBase {
  tags: (Shorter | "x")[];
  maybe: (Shorter | null)[];
}
model TagsRenamed extends TagsBase {
  @encodedName("application/json", "tags") t2: (Shorter | null)[];
}
/** `Short`'s keywords on each member of a union that is not `Short`: the `string`, not the literal. */
model TagsLoose extends TagsBase {
  @encodedName("application/json", "tags") t3: (string | "ab")[];
}

/**
 * `Short`'s keywords on each member of the override's union, where neither element narrows the
 * other: the `string` member, and not the literal `Short` admits.
 */
model MixedBase {
  tags: (Short | int32)[];
}
model MixedSub extends MixedBase {
  @encodedName("application/json", "tags") t4: (string | "ab")[];
}

/** A named list model keeps its own keywords. */
@minItems(2)
model TagList is Shorter[];
model ListBase {
  tags: Short[];
}
model ListSub extends ListBase {
  tags: TagList;
}

/** Literals the ancestor's type refuses are merged out, member by member. */
@pattern("^[a-z]+$")
scalar Code extends string;
model CodeBase {
  c: Code;
}
model CodeSub extends CodeBase {
  c: "ab" | "CD";
}
enum Color {
  red,
  blue,
}
model HueBase {
  c: Color;
}
model HueSub extends HueBase {
  @encodedName("application/json", "c") c2: "red" | "green";
}

/** A recursive subtype narrowing its own base's lists. */
model Tree {
  name: Short;
  kids?: Tree[];
  tags: Short[];
}
model TreeSub extends Tree {
  kids?: TreeSub[];
  tags: Shorter[];
}

/** Objects merged key by key. */
model Item {
  id: string;
}
model Widget extends Item {
  color?: string;
}
model Page<T> {
  items: T[];
  next?: string;
}
model PageBase {
  page: Page<Item>;
}
model PageSub extends PageBase {
  page: Page<Widget>;
}
model InlineBase {
  meta: {
    tag: string;
  };
}
model InlineSub extends InlineBase {
  meta: {
    tag: "a";
  };
}
model LabelBase {
  meta: Label;
}
model LabelSub extends LabelBase {
  meta: Label & {
    extra?: string;
  };
}
model Open {
  tag: string;
  ...Record<unknown>;
}
model AttrsBase {
  attrs: Record<unknown>;
}
model AttrsSub extends AttrsBase {
  attrs: Open;
}
model WithProps {
  x: int32;
  ...Record<string>;
}
model PropsBase {
  p: WithProps;
}
model PropsSub extends PropsBase {
  @encodedName("application/json", "p") p2: Record<string>;
}
model ShortLabel {
  @maxLength(2) tag: string;
}
model UnrelatedBase {
  meta: ShortLabel;
}
model UnrelatedSub extends UnrelatedBase {
  @encodedName("application/json", "meta") m2: Label;
}

/** Scalars that TypeSpec does not call assignable, and the document reads alike or as both. */
model FloatBase {
  f: float;
}
model FloatSub extends FloatBase {
  @encodedName("application/json", "f") g: int32;
}
model InstantBase {
  at: utcDateTime;
}
model InstantSub extends InstantBase {
  @encodedName("application/json", "at") at2: offsetDateTime;
}
model WidthBase {
  n: int8;
}
model WidthSub extends WidthBase {
  @encodedName("application/json", "n") m: uint8;
}

/** An encoding that keeps its declared type beside another, merged whole. */
model PaintBase {
  @encode("x", string) c: Color;
}
model PaintSub extends PaintBase {
  @encodedName("application/json", "c") c2: "red" | "green";
}

/** The `string` openapi3 adds where the model declaring the discriminator does not. */
@discriminator("kind")
model Shape {
  name: string;
}
model Square extends Shape {
  kind: "square";
}
model Odd extends Shape {
  @encodedName("application/json", "kind") other: string | null;
}
/** Refused as `invalid-subtype-discriminator`: it publishes `kind` as `Odd`'s `string | null`. */
model OddLeaf extends Odd {
  @encodedName("application/json", "k") kind: "oddleaf";
}

/** A variant no value is - its discriminator refused above it - leaves the union to the rest. */
model Snake {
  @maxLength(3) kind: string;
  length: int32;
}
model Cobra extends Snake {
  kind: "cobra";
  hood: int32;
}
model Asp extends Snake {
  kind: "asp";
}
@discriminated(#{ envelope: "none" })
union Serpent {
  cobra: Cobra,
  asp: Asp,
}

/** Declarations above a response that the response does not publish, and one a `never` leaves. */
model SecretBase {
  @visibility(Lifecycle.Create) @minLength(5) secret: string;
}
model SecretSub extends SecretBase {
  secret: string;
}
model PasswordBase {
  @maxLength(5) password: string;
  name: string;
}
model PasswordSub extends PasswordBase {
  @visibility(Lifecycle.Create) password: string;
}
model HeaderBase {
  @header("x-name") @maxLength(2) name: string;
  id: string;
}
model HeaderSub extends HeaderBase {
  name: string;
}
model GoneBase {
  @maxLength(3) x: string;
  y: int32;
}
model GoneSub extends GoneBase {
  x: never;
}

@route("/null") @post op nullSub(@body body: NullSub): void;
@route("/pet") @post op petSub(@body body: PetSub): void;
@route("/tags") @post op tagsSub(@body body: TagsSub): void;
@route("/tags-renamed") @post op tagsRenamed(@body body: TagsRenamed): void;
@route("/tags-loose") @post op tagsLoose(@body body: TagsLoose): void;
@route("/mixed") @post op mixedSub(@body body: MixedSub): void;
@route("/list") @post op listSub(@body body: ListSub): void;
@route("/code") @post op codeSub(@body body: CodeSub): void;
@route("/hue") @post op hueSub(@body body: HueSub): void;
@route("/tree") @post op treeSub(@body body: TreeSub): void;
@route("/page") @post op pageSub(@body body: PageSub): void;
@route("/inline") @post op inlineSub(@body body: InlineSub): void;
@route("/label") @post op labelSub(@body body: LabelSub): void;
@route("/attrs") @post op attrsSub(@body body: AttrsSub): void;
@route("/props") @post op propsSub(@body body: PropsSub): void;
@route("/unrelated") @post op unrelatedSub(@body body: UnrelatedSub): void;
@route("/float") @post op floatSub(@body body: FloatSub): void;
@route("/instant") @post op instantSub(@body body: InstantSub): void;
@route("/width") @post op widthSub(@body body: WidthSub): void;
@route("/paint") @post op paintSub(@body body: PaintSub): void;
@route("/odd") @post op odd(@body body: Odd): void;
@route("/serpent") @post op serpent(@body body: Serpent): void;
@route("/secret") @get op readSecret(): SecretSub;
@route("/password") @get op readPassword(): PasswordSub;
@route("/header") @get op readHeader(): HeaderSub;
@route("/gone") @post op gone(@body body: GoneSub): void;
