import "@typespec/http";
import "@typespec/streams";
import "@typespec/events";
import "@typespec/sse";

using Http;
// `Streams` alone is ambiguous between `TypeSpec.Streams` and `TypeSpec.Http.Streams`; the
// JSON Lines helper lives in the HTTP one.
using Http.Streams;
using Events;
using SSE;

/**
 * Streamed responses, whose payloads are NOT reachable from the response body.
 *
 * Under OpenAPI 3.1 the body of an SSE operation is `{"type": "string"}` — the event stream itself —
 * so a walk that follows bodies sees a scalar and stops. The event payloads are published as
 * components all the same, and nothing here could validate them.
 */
@service(#{ title: "streaming" })
namespace Streaming;

model Tick {
  at: string;
  value: int32;
}

model Closed {
  reason: string;
}

@events
union FeedEvents {
  tick: Tick,
  closed: Closed,
}

@route("/feed") op feed(): SSEStream<FeedEvents>;

/** JSON Lines carries the item model directly rather than an `@events` union. */
@route("/lines") op lines(): JsonlStream<Tick>;
