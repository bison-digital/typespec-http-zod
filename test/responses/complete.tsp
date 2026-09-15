import "@typespec/http";

using Http;

/**
 * **Every response the document declares, each carrying what the document says about IT.**
 *
 * A server emitter types a handler's return as the union of these arms, one member per status. That
 * only works if each arm is complete on its own: its own body, its own headers, its own media types,
 * whatever kind of status key it is. Each operation below is a way an arm used to arrive incomplete.
 */
@service(#{ title: "Complete" })
namespace Complete;

model Note {
  id: string;
}

model Ticket {
  ticket: string;
}

/**
 * **Two success statuses with DIFFERENT bodies.** Each arm has to validate against its own model.
 * The 202 arm used to carry the 200 arm's schema, because a status selector assumed one model for
 * every success status.
 */
model Opened {
  @statusCode _: 200;
  @body body: Note;
}

model Queued {
  @statusCode _: 202;
  @body body: Ticket;
}

@route("/two")
@post
op two(): Opened | Queued;

/** An exact failure status declaring a header. */
@error
model TooMany {
  @statusCode _: 429;
  @header("retry-after") retryAfter: int32;
  message: string;
}

/** A failure RANGE declaring an optional header. */
@error
model Throttled {
  @minValue(400)
  @maxValue(499)
  @statusCode
  code: int32;

  @header("x-maybe") maybe?: string;
  reason: string;
}

/** The catch-all, which declares no status and so becomes `default`. */
@error
model Unexpected {
  message: string;
}

@route("/guarded")
@get
op guarded(): Note | TooMany | Throttled | Unexpected;

/** A success declared only as a RANGE. It used to be dropped without a diagnostic. */
model Ranged {
  @minValue(200)
  @maxValue(299)
  @statusCode
  code: int32;

  @body body: Note;
}

@route("/ranged")
@get
op ranged(): Ranged;

/** Inline bodies on a success AND a failure, so neither has a component name to be referred to by. */
@route("/inline")
@get
op inline():
  | {
      @statusCode _: 200;
      @body body: {
        x: string;
      };
    }
  | {
      @statusCode _: 404;
      @body body: {
        y: string;
      };
    };
