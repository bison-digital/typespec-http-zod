import "@typespec/http";
import "@typespec/openapi3";

using Http;

/**
 * Tuples, which openapi3 publishes as `prefixItems` with no `items` or `minItems`: any length, each
 * position checked where present, anything past the last. Refused as a parameter or a header.
 */
@service(#{ title: "Tuples" })
namespace Tuples;

model Point {
  x: int32;
  y: int32;
}
model Shapes {
  pair: [int32, string];
  empty: [];
  nullable: [string | null, Point];
  literal: ["a", 1, true];
  points: [Point, Point][];
  maybe?: [boolean];
}
/** An OAuth2 flow model, which openapi3 publishes as a component though no operation reaches it. */
model Flow {
  type: "implicit";
  scopes: ["read", "write"];
}

/** Reached first by a parameter, then by a body: a component both share, its tuple validated. */
model Window {
  range?: [int32, int32];
}

@route("/w") @get op window(@query window?: Window): void;
@route("/w") @post op setWindow(@body body: Window): void;
@route("/s") @post op send(@body body: Shapes): Shapes;
@route("/q") @get op query(@query q?: [int32, string]): void;
@route("/h") @get op header(): {
  @header("x-pair") pair: [int32, string];
};
