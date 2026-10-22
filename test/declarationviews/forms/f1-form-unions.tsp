import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";
using Http;
using OpenAPI;

/**
 * URL-encoded bodies whose type is, or holds, a union that is not a plain union of models: a
 * discriminated union with no envelope or with one, a union nested in a union, and a union beside
 * members that are not objects. Each form is read from the text it carries and judged by the body's
 * whole schema, as the document reads it.
 */
@service(#{ title: "Form unions" })
namespace FormUnions;

model DA {
  kind: "a";
  n?: int32;
  b?: boolean;
}
model DB {
  kind: "b";
  n?: string;
  l?: int32[];
}
/** A member nothing in which reads from text, its `n` a string where `DA`'s is a number. */
model DC {
  kind: "c";
  n?: string;
}
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union DU {
  a: DA,
  b: DB,
}
union PU {
  DA,
  DB,
}
union NestU {
  PU,
  DB,
}
union WithStr {
  DA,
  string,
}
union WithInt {
  DA,
  int32,
}
@discriminated
union DE {
  i: int32,
  l: int32[],
  s: string,
  m: DA,
}
@oneOf
union XO {
  DA,
  DC,
}
model PA {
  x?: int32;
}
model PB {
  x?: string;
}
/** Two members that each take `x=5`, one reading apiece: exactly one matches each reading. */
@oneOf
union XP {
  PA,
  PB,
}

alias Form = "application/x-www-form-urlencoded";

@route("/du") @post op du(@header contentType: Form, @body body: DU): void;
@route("/dn") @post op dn(@header contentType: Form, @body body: DU | null): void;
@route("/dj") @post op dj(@header contentType: Form | "application/json", @body body: DU): void;
@route("/ws") @post op ws(@header contentType: Form, @body body: WithStr): void;
@route("/wi") @post op wi(@header contentType: Form, @body body: WithInt): void;
@route("/nu") @post op nu(@header contentType: Form, @body body: NestU): void;
@route("/mx") @post op mx(@header contentType: Form, @body body: DA | DB | DU): void;
@route("/de") @post op de(@header contentType: Form, @body body: DE): void;
@route("/pc") @post op pc(@header contentType: Form, @body body: DC | DA): void;
@route("/xo") @post op xo(@header contentType: Form, @body body: XO): void;
@route("/xp") @post op xp(@header contentType: Form, @body body: XP): void;
@route("/u") @post op u(@header contentType: Form, @body body: DA | DB): void;
