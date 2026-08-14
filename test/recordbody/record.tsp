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
