import "@typespec/http";

using Http;

/**
 * **A body with an indexer cannot be spread into the parameters.**
 *
 * Merged, the intersection's index signature is imposed on every sibling, so an optional query
 * parameter fails with `TS2345: 'q' is incompatible with index signature` and the generated server
 * does not compile. It was also wrong before it failed to compile: the document states the parameters
 * and the body separately, and merged, a body key named `q` silently overwrites the query parameter.
 */
@service(#{ title: "Rec" })
namespace Rec;

@route("/x")
@post
op x(@query q?: string, @body body: Record<string>): void;

/** The form case, which the first fixture missed: a declared content type changes the resolution. */
@route("/z")
@post
op z(
  @header contentType: "application/x-www-form-urlencoded",
  @query q?: string,
  @body body: Record<string>,
): void;

/** The control: an ordinary model body is still spread, so nothing else moved. */
model Thing {
  id: string;
}

@route("/y")
@post
op y(@query q?: string, @body body: Thing): void;

/**
 * **A body that is not a MODEL cannot be spread either, and losing it was silent.**
 *
 * `@body body: string` emitted a handler input of `Record<string, never>`: the server validated the
 * body and handed the handler nothing, from a compile that reported success. An enum body failed
 * loudly instead, `TS2698`, which is what four conformance scenarios were pinned on.
 */
@route("/s")
@post
op s(@query q?: string, @body body: string): void;

enum Colour {
  red,
  green,
}

@route("/e")
@post
op e(@body body: Colour): void;

@route("/u")
@post
op u(@body body: string | int32): void;

/** A string body a caller sends as JSON is JSON: the same type, a different frame. */
@route("/j")
@post
op j(@header contentType: "application/json", @body body: string): void;

/** Bytes are named by `rawBodyProperty`, and naming them twice would put one value under two keys. */
@route("/b")
@post
op b(@body body: bytes): void;
