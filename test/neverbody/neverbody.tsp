import "@typespec/http";

using Http;

/**
 * **A body declared `never` is refused.** `never` has no values, so the body cannot exist, and
 * openapi3 - whose body paths test only for `void` - publishes it as `application/json` with
 * `schema: {}`, any value at all. See `neverbody.test.ts`.
 */
@service(#{ title: "Never body" })
namespace NeverBody;

model Thing {
  id: string;
}

@error
model NeverGone {
  @statusCode _: 410;
  @body body: never;
}

@route("/responses")
@get
op responses(): Thing | NeverGone;

@route("/never")
@post
op neverRequest(@body body: never): Thing;
