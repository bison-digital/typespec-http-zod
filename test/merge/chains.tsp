import "@typespec/http";
import "@typespec/openapi3";

using Http;
using OpenAPI;

/**
 * Chains of declarations the document holds a value to, each as openapi3 publishes it: a union of
 * declared scalars, a list literal's elements, a base's visibility and indexer, a named list's
 * keywords, a nested `null`, a union a request reshapes, an envelope on a cycle, and `@oneOf`.
 */
@service(#{ title: "Chains" })
namespace Chains;

/** Into a union of declared scalars: the override is one member or the other, never both. */
@pattern("^[a-z]+$")
scalar Lower extends string;
@pattern("^[0-9]+$")
scalar Digits extends string;
@maxLength(4)
scalar Digits2 extends Digits;
model U1 {
  v: Lower | Digits;
}
model U2 extends U1 {
  v: Digits2;
}
@maxValue(10)
scalar Small extends int32;
@minValue(100)
scalar Big extends int32;
@minValue(200)
scalar Bigger extends Big;
model N1 {
  n: Small | Big;
}
model N2 extends N1 {
  n: Bigger;
}

/** A list literal's element: `Item` visibility, where a `@header` is data and PATCH requires it. */
model Tagged {
  @header("x-code") @maxLength(3) code: string;
  name: string;
}
model Holder {
  @header("x-z") z: string;
  items: Tagged[];
}
model El {
  @visibility(Lifecycle.Update) u: string;
  name: string;
}
model Wrap {
  els: El[];
}

/** A base judged at its own visibility: the canonical `Base`, its read-only `id` shared in. */
model Base {
  @visibility(Lifecycle.Read) @maxLength(3) id: string;
  name: string;
}
model Derived extends Base {
  @visibility(Lifecycle.Create) secret: string;
}

/** The topmost indexer holds every key it does not declare; one below it never applies. */
model Inner {
  x: string;
}
model Inner2 {
  x: string;
  y?: int32;
}
model Base5 {
  ...Record<Inner>;
}
model Sub5 extends Base5 {
  m: Inner2;
}
@maxLength(3)
scalar S3 extends string;
model BaseS {
  ...Record<string>;
}
model SubS extends BaseS {
  ...Record<S3>;
}

/** A named list model's own keywords hold where an override narrows it. */
@minItems(2)
model Pair is string[];
@maxItems(2)
model Duo is Lower[];
model L1 {
  b: Pair;
}
model L2 extends L1 {
  b: Duo;
}

/** A `null` nested in a narrowing override, which the declaration above refuses. */
model A9 {
  xs: string[];
  r: Record<string>;
}
model B9 extends A9 {
  @encodedName("application/json", "xs") xs2: (string | null)[];
  @encodedName("application/json", "r") r2: Record<string | null>;
}

/** A named union a request reshapes, declared once per visibility. */
model Widget {
  @visibility(Lifecycle.Create) secret: string;
  name: string;
}
union WidgetOr {
  widget: Widget,
  text: string,
}
model NHolder {
  n: WidgetOr;
}

/** An envelope on a cycle, through the variant's own property. */
model Cat {
  meow: boolean;
  owner?: PHolder;
}
model Dog {
  bark: boolean;
}
@discriminated
union PetsE {
  cat: Cat,
  dog: Dog,
}
model PHolder {
  pet: PetsE;
}

/** `@oneOf`: exactly one member accepts a value. */
model OA {
  a?: string;
  ...Record<unknown>;
}
model OB {
  b?: string;
  ...Record<unknown>;
}
@oneOf
union OU {
  a: OA,
  b: OB,
}
model OH {
  u: OU;
}

/** Defaults a declaration above rules out, and one a declaration above makes required. */
model Anc1 {
  @maxValue(3) x?: int32;
  @maxLength(2) s?: string;
}
model Anc2 extends Anc1 {
  x?: int32 = 5;
  s?: string = "abc";
}
model F1 {
  x: int32;
}
model F2 extends F1 {
  @encodedName("application/json", "x") x2?: int32 = 1;
}

@route("/u") @post op u(@body body: U2): void;
@route("/nn") @post op nn(@body body: N2): void;
@route("/e") @post op e(@body body: Holder): void;
@route("/f") @get op f(): Tagged[];
@route("/w") @patch(#{ implicitOptionality: true }) op patchWrap(@body body: Wrap): void;
@route("/d") @post op createDerived(@body body: Derived): Derived;
@route("/s5") @post op s5(@body body: Sub5): void;
@route("/ss") @post op ss(@body body: SubS): void;
@route("/l") @post op l(@body body: L2): void;
@route("/b9") @post op b9(@body body: B9): void;
@route("/n") @post op createN(@body body: NHolder): NHolder;
@route("/n") @get op readN(): NHolder;
@route("/cat") @post op cat(@body body: Cat): void;
@route("/oh") @post op oh(@body body: OH): void;
@route("/anc") @post op anc(@body body: Anc2): void;
@route("/f2") @post op f2(@body body: F2): void;
