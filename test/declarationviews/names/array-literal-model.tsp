import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

/**
 * A list model the spec names `Array`, which openapi3 takes for a list literal - `T[]` - and so
 * writes out wherever it is used with none of the model's own keywords. A list of any other name is
 * a declaration and keeps them.
 */
@service(#{ title: "Array literal model" })
namespace ArrayLiteralModel;

/** The list's own description. */
@summary("A summary")
@minItems(1)
@maxItems(3)
@extension("x-list", "own")
model Array is int32[];

@minItems(1)
@maxItems(3)
model Tags is int32[];

model H {
  a?: Array;
  /** Its own description. */
  @minItems(2) b?: Array;
  t?: Tags;
}

@route("/a") @post op a(@body body: H, @query q?: Array, @header h?: Array): H;
@route("/b") @post op b(@body body: Array): Array;
