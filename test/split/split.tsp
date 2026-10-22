import "@typespec/http";
import "@typespec/openapi3";

using Http;

/**
 * Components `@typespec/openapi3` writes from the first reference that reaches them, one shape per
 * letter. Where that reference is a request's and the model has nothing to reshape there, openapi3
 * reads its `required` at `Read` and its properties at the request's visibility: a read-only `id` is
 * required and not declared, or, optional, left out - in every use of the component.
 */
@service(#{ title: "Split" })
namespace Split;

/** A: reached only from a create body, through a model the request reshapes. Refused. */
model InnerA {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterA {
  @visibility(Lifecycle.Create) secret: string;
  inner: InnerA;
}
@route("/a") @post op createA(@body body: OuterA): void;

/** B: returned by an earlier operation, so reached at `Read` first. Published as declared. */
model InnerB {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterB {
  @visibility(Lifecycle.Create) secret: string;
  inner: InnerB;
}
@route("/b") @get op readB(): InnerB;
@route("/b") @post op createB(@body body: OuterB): void;

/** C: returned by a later operation, which shares the request's schema. Refused. */
model InnerC {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterC {
  @visibility(Lifecycle.Create) secret: string;
  inner: InnerC;
}
@route("/c") @post op createC(@body body: OuterC): void;
@route("/c") @get op readC(): InnerC;

/** D: through a model nothing reshapes - its own properties read at `Create` too. `DeepD` refused. */
model DeepD {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model MidD {
  deep: DeepD;
  m: string;
}
model OuterD {
  @visibility(Lifecycle.Create) secret: string;
  mid: MidD;
}
@route("/d") @post op createD(@body body: OuterD): void;

/** G: a list and a union expression keep `Create`; a dictionary and a named union reduce to `Read`. */
model I1G {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model I2G {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model I3G {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model I4G {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
union UG {
  a: I4G,
  b: string,
}
model OuterG {
  @visibility(Lifecycle.Create) secret: string;
  l: I1G[];
  u: I2G | string;
  r: Record<I3G>;
  nu: UG;
}
@route("/g") @post op createG(@body body: OuterG): void;

/** I: an operation's own anonymous body. Refused. */
model InnerI {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
@route("/i") @post op createI(@visibility(Lifecycle.Create) secret: string, inner: InnerI): void;

/** J: a PUT, read at `CreateOrUpdate`. Refused. */
model InnerJ {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterJ {
  @visibility(Lifecycle.Update) secret: string;
  inner: InnerJ;
}
@route("/j") @put op replaceJ(@body body: OuterJ): void;

/**
 * K: a base, reached through `allOf` from a subtype the request reshapes. `BaseK` refused. Returned by
 * a later operation too, or openapi3 names `DerivedK` bare at both `Create` and, through `BaseK`'s
 * derived models, `Read`, and refuses its own document with `duplicate-type-name`.
 */
model BaseK {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model DerivedK extends BaseK {
  @visibility(Lifecycle.Create) secret: string;
}
@route("/k") @post op createK(@body body: DerivedK): void;
@route("/k") @get op readK(): DerivedK;

/** M: the indexer and a property of a model the request reshapes. Both refused. */
model I3M {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model I5M {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model MM {
  ...Record<I3M>;
  @visibility(Lifecycle.Create) secret: string;
  x: I5M;
}
@route("/m") @post op createM(@body body: MM): void;

/** N: an optional read-only property is left out, and a sealed response refuses it. Refused. */
model InnerN {
  @visibility(Lifecycle.Read) id?: string;
  name: string;
}
model OuterN {
  @visibility(Lifecycle.Create) secret: string;
  inner: InnerN;
}
@route("/n") @post op createN(@body body: OuterN): void;
@route("/n") @get op readN(): InnerN;

/** Q: a discriminated base nothing reshapes renders its subtypes at `Read`. Published as declared. */
@discriminator("kind")
model PetQ {
  kind: string;
}
model CatQ extends PetQ {
  kind: "cat";
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterQ {
  @visibility(Lifecycle.Create) secret: string;
  pet: PetQ;
}
@route("/q") @post op createQ(@body body: OuterQ): void;

/** S: a named list is not reduced: `PairSCreate` and `PairS`, and its items read at `Create`. */
model InnerS {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model PairS is InnerS[];
model OuterS {
  @visibility(Lifecycle.Create) secret: string;
  xs: PairS;
}
@route("/s") @post op createS(@body body: OuterS): void;
@route("/s") @get op readS(): PairS;

/** V: a model expression, in a component and in an operation's own body. Both refused. */
model OuterV {
  @visibility(Lifecycle.Create) secret: string;
  meta: {
    @visibility(Lifecycle.Read) id: string;
    name: string;
  };
}
@route("/v") @post op createV(@body body: OuterV): void;
@route("/v2") @post op createV2(
  @visibility(Lifecycle.Create) secret: string,
  meta: {
    @visibility(Lifecycle.Read) id: string;
    name: string;
  },
): void;

/** O: one operation's response is emitted before its request body. Published as declared. */
model InnerO {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterO {
  @visibility(Lifecycle.Create) secret: string;
  inner: InnerO;
}
@route("/o") @post op createO(@body body: OuterO): InnerO;

/** W: an operation's own body is collapsed to `Read` whatever it is - a list of model expressions too. */
@route("/w") @post op createW(
  @body body: {
    @visibility(Lifecycle.Read) id: string;
    name: string;
  }[],
): void;

/** P: a parameter whose type nothing reshapes is read at `Read`. Published as declared. */
model InnerP {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
@route("/p") @post op createP(@query q: InnerP): void;
