import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;

/**
 * A property's `@oneOf` on an inline union, merged under a redeclaration: `Leaf`'s `u` is `S3` and
 * `Root`'s `X1 | X2` at once, and exactly one of the two members.
 */
@service(#{ title: "Merged oneOf property" })
namespace MergedOneOf;

enum Color {
  red,
  green,
}
model X1 {
  @visibility(Lifecycle.Create, Lifecycle.Read) c?: Color.green;
}
model X2 {
  @minLength(2) b?: string;
}
model S3 {
  @minLength(2) b?: string;
  g?: string;
}
model Root {
  @oneOf u: X1 | X2;
}
model Leaf extends Root {
  u: S3;
}
@route("/l") @patch(#{ implicitOptionality: true }) op p(@body body: Leaf): void;
@route("/l") @post op c(@body body: Leaf): Leaf;
