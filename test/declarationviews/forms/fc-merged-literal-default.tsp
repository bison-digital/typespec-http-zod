import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;

/**
 * A default a declaration above refuses, where the declaration above is a literal: a key renamed
 * onto its base's with `@encodedName`, which the compiler does not hold to the base, and a key of a
 * model merged with a record of one enum member.
 */
@service(#{ title: "Merged literal defaults" })
namespace MergedLiteralDefaults;

enum Color {
  red,
  green,
}
model M14 {
  a?: string = "a";
}
model Root {
  k?: Record<Color.red>;
}
model Sub extends Root {
  @encodedName("application/json", "k") kk?: M14;
}
model RootG {
  k?: "b";
}
model Leaf extends RootG {
  @encodedName("application/json", "k") kk?: string = "abcd";
}
model RootE {
  k?: "red" | "green";
}
model LeafE extends RootE {
  @encodedName("application/json", "k") kk?: string = "a";
}
/** A default the literal above holds, which stays. */
model LeafOk extends RootE {
  @encodedName("application/json", "k") kk?: string = "red";
}
model Root2 {
  k: "b";
}
model Leaf2 extends Root2 {
  @encodedName("application/json", "k") kk?: string = "abcd";
}

@route("/s") @post op s(@body body: Sub): void;
@route("/p") @post op p(@body body: Leaf): void;
@route("/e") @post op e(@body body: LeafE): void;
@route("/o") @post op o(@body body: LeafOk): void;
@route("/q") @post op q(@body body: Leaf2): void;
