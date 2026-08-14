import "@typespec/http";

using Http;

/**
 * **What a response arm must carry beyond a status and a body schema.**
 *
 * `deps.respond` receives the arms and chooses one. It was given `{ status, schema }` and nothing
 * else, so two facts the document publishes never reached it:
 *
 * - **the media type an arm answers with.** An operation whose one status offers `application/json`
 *   and `text/event-stream` had a single arm carrying the JSON schema, and the alternative was dropped
 *   from the list entirely. A non-JSON operation could not be served faithfully through the generated
 *   server at all.
 * - **the headers the arm declares.** A `Location` on a 302, a `Link`, a correlation echo: the
 *   document publishes them under `responses.<code>.headers` and the server could not set them.
 *
 * Both were reported by consumers as blocking, and both are facts the document already states, so
 * neither is invented here.
 */
@service(#{ title: "Arms" })
namespace Arms;

model Note {
  id: string;
}

/** Headers on a redirect: the case where the header IS the response. */
model Moved {
  @statusCode statusCode: 302;
  @header location: string;
}

/** Headers beside a body, so the two are carried together rather than one displacing the other. */
model Created {
  @statusCode statusCode: 201;
  @header location: string;
  @header("x-correlation-id") correlationId: string;
  @body body: Note;
}

@route("/go")
@get
op go(): Moved;

@route("/notes")
@post
op create(): Created;

/** The control: an ordinary arm declares no headers and must not acquire any. */
@route("/plain")
@get
op plain(): Note;

/**
 * **One status, two media types**, which is what a discovery document or an SSE alternative looks
 * like. The arm carried the first schema and dropped the alternative from the list entirely, so
 * `deps.respond` could not tell what it was answering with.
 */
model Doc {
  @statusCode statusCode: 200;
  @header contentType: "application/json" | "text/html";
  @body body: Note;
}

@route("/discovery")
@get
op discovery(): Doc;
