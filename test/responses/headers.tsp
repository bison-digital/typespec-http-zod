import "@typespec/http";

using Http;

/**
 * Response headers whose wire type an `@encode` decides.
 *
 * A header's TYPE is what a handler must supply and its SCHEMA is what the server checks before it
 * sends it, so the two have to describe one value. `@encode(seconds, int32)` makes a `duration` an
 * integer on the wire: the schema checked an integer while the type demanded a string, so the arm
 * could not be returned without a cast.
 */
@service(#{ title: "Response headers" })
namespace ResponseHeaders;

model Thing {
  id: string;
}

@route("/throttled")
@get
op read(): Thing | {
  @statusCode statusCode: 429;
  @header("Retry-After") @encode(DurationKnownEncoding.seconds, int32) retryAfter: duration;
  @header("x-reset") @encode(DateTimeKnownEncoding.unixTimestamp, int64) resetAt: utcDateTime;
  @header("x-window") @encode(DurationKnownEncoding.seconds, int32) window?: duration;
  @header("x-plain") plain: string;
  @header("x-count") count: int32;
  @header("x-iso") iso: duration;
};
