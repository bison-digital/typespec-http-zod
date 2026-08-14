import "@typespec/http";

using Http;

/**
 * **An operation whose only declared response is a redirect.**
 *
 * Routes were collected from a status filter that accepted 2xx only, so this operation had no status,
 * was skipped by a bare `continue`, and vanished with no diagnostic. The document declared the route
 * and the emitted output had no trace of it, so a client generated from that document would 404 while
 * `tsp compile` reported success.
 *
 * A redirect is not an error and not a failure to serve: it is an outcome a handler returns and
 * `deps.respond` emits. 4xx and 5xx stay out because they are error arms, collected from `@error`
 * models separately.
 */
@service(#{ title: "Go" })
namespace Go;

model Moved {
  @statusCode statusCode: 302;
  @header location: string;
}

model Thing {
  id: string;
}

@route("/go")
@get
op go(): Moved;

/** The non-vacuity partner: if nothing at all is emitted, the arm below must not pass. */
@route("/thing")
@get
op thing(): Thing;
