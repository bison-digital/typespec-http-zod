import "@typespec/http";

using Http;

/**
 * Bodies that offer a CHOICE of media type.
 *
 * `@typespec/http` refuses two operations on one route, so a request-side choice can only be written
 * as one operation whose `contentType` header is a union. The document publishes one schema against
 * several `requestBody.content` keys, and a server has to know all of them to parse the body it was
 * actually sent.
 */
@service(#{ title: "several media types" })
namespace SeveralMediaTypes;

model Item {
  id: string;
  qty: int32;
}

/** Two parseable forms of one body: the case a server has to dispatch on. */
@route("/either")
@post
op createFromEither(
  @header contentType: "application/json" | "application/x-www-form-urlencoded",

  @body body: Item,
): void;

/** Three, including one nothing can parse, which must still be reported rather than dropped. */
@route("/three")
@post
op createFromThree(
  @header contentType: "application/json" | "application/xml" | "text/plain",

  @body body: Item,
): void;

/** One media type, so the arm is not measuring only the plural case. */
@route("/one")
@post
op createFromOne(@body body: Item): void;

/** Raw binary, where the media type decides that no validator may be emitted at all. */
@route("/raw")
@post
op createFromRaw(
  @header contentType: "application/octet-stream",

  @body body: bytes,
): void;
