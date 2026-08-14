import "@typespec/http";

using Http;

/**
 * **An optional property must not be typed as admitting an explicit `undefined`.**
 *
 * `z.infer` of `.optional()` gives `p?: T | undefined`, which under `exactOptionalPropertyTypes`
 * means "absent, or T, or explicitly undefined". **JSON cannot carry `undefined`**, so the wire can
 * only produce "absent or T", and the document says exactly that by leaving the property out of
 * `required`. The emitted type was therefore wider than both the document and the wire, and a
 * consumer building one of these values had to strip it at the boundary.
 *
 * The narrowing is derived from the same schema, so there is still one source of truth.
 */
@service(#{ title: "Optionals" })
namespace Optionals;

model Thing {
  id: string;
  note?: string;
  count?: int32;
}

@route("/things")
@post
op create(@body body: Thing): Thing;
