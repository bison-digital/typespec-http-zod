import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;

/**
 * Unions sent as a URL-encoded form that no reading makes ambiguous, graded against the document:
 * a `@oneOf` whose members read each key one way, a string literal no number spells, a discriminated
 * union, and the overlapping members as `anyOf`.
 */
@service(#{ title: "Distinct oneOf forms" })
namespace DistinctOneOfForms;

model P {
  x?: int32;
}
model Q {
  x?: string;
}
@oneOf union V {
  P,
  Q,
}

model A {
  x?: int32 | "all";
}
model B {
  y?: boolean;
}
@oneOf union W {
  A,
  B,
}

@discriminated(#{ envelope: "none" })
union D {
  m: DM,
  n: DN,
}
model DM {
  kind: "m";
  x?: int32 | string;
}
model DN {
  kind: "n";
  x?: int32;
}

model M {
  x?: int32 | string;
}
model N {
  x?: int32;
}
union AnyOf {
  M,
  N,
}

/** Open, `b` is either member's - but `B2`'s reading leaves `a` as text, which `A2` refuses. */
model A2 {
  a: int32;
}
model B2 {
  b: string;
}
@oneOf union R2 {
  A2,
  B2,
}

@route("/r") @post op r(@header contentType: "application/x-www-form-urlencoded", @body body: R2): void;
@route("/v") @post op v(@header contentType: "application/x-www-form-urlencoded", @body body: V): void;
@route("/w") @post op w(@header contentType: "application/x-www-form-urlencoded", @body body: W): void;
@route("/d") @post op d(@header contentType: "application/x-www-form-urlencoded", @body body: D): void;
@route("/a") @post op a(@header contentType: "application/x-www-form-urlencoded", @body body: AnyOf): void;
