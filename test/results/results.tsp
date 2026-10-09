import "@typespec/http";
import "@typespec/streams";
import "@typespec/events";
import "@typespec/sse";

using Http;
using Http.Streams;
using Events;
using SSE;

/**
 * One operation per shape a result can take, and every one `WireOutputs` collapsed.
 *
 * **A result is a status, a body and its headers, and the body depends on the status.** `WireOutputs`
 * published one body per operation - the lowest success status's - so `200 Thing | 201 Other` said
 * `Thing`, `200 Thing | 204` said `Thing`, and an operation answering only `204` was absent. Nothing
 * framework-free named the `{ status, body, headers }` union a server's handlers return, so a backend
 * reached over a service binding typed its result `{ status: number }` and lost the pairing.
 */
@service(#{ title: "Results" })
namespace Results;

model Thing {
  id: string;
}

model Other {
  other: string;
}

model Deletion {
  scheduledFor: string;
  started: boolean;
}

@error
model OrgError {
  code: string;
}

model Problem {
  title: string;
}

model Tick {
  at: string;
}

@events
union Ticks {
  tick: Tick,
}

@route("/thing") @get op getThing(): Thing;

/** Two success statuses, two bodies: the second was dropped. */
@route("/mixed") @get op mixed(): Thing | {
  @statusCode statusCode: 201;
  @body body: Other;
};

/** A body or no content: the 204 was dropped. */
@route("/body-or-none") @get op bodyOrNone(): Thing | {
  @statusCode statusCode: 204;
};

/** Two success statuses, ONE model: a backend has to say which. */
@route("/deletion") @post op scheduleDeletion():
  | {
      @statusCode statusCode: 201;
      @body body: Deletion;
    }
  | Deletion
  | OrgError;

/** No success body at all: absent from `WireOutputs`. */
@route("/deletion") @delete op cancelDeletion(): {
  @statusCode statusCode: 204;
} | OrgError;

/** A failure carrying a header. */
@route("/throttled") @get op throttled(): Thing | {
  @statusCode statusCode: 429;
  @header("Retry-After") retryAfter: string;
  @body body: Problem;
};

/** A success declared only as a range. */
@route("/ranged") @get op ranged(): {
  @minValue(200) @maxValue(299) @statusCode code: int32;
  @body body: Thing;
};

/** One status, two media types: two members, told apart by `contentType`. */
@route("/negotiated") @get op negotiated(): {
  @header contentType: "application/json" | "text/plain";
  @body body: string;
};

/** A binary body, and one under a media range. */
@route("/download") @get op download(): {
  @header contentType: "image/png";
  @body body: bytes;
};

@route("/image") @get op image(): {
  @header contentType: "image/*";
  @body body: bytes;
};

/** A stream of events. */
@route("/ticks") @get op ticks(): SSEStream<Ticks>;

/** Failures only: no success member at all. */
@route("/refuse") @get op refuse(): OrgError;

/** An `Http.File` response: bytes, with the media type named where there is a choice. */
@route("/file") @get op downloadFile(): Http.File<"image/png" | "image/jpeg">;
