import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

/**
 * **`@encode` where what the document publishes depends on more than the declared type's kind.**
 *
 * How many members openapi3 publishes for a nullable union, whether a union is a `$ref`, which members
 * keep their own check under an encoding, a scalar with no type at all, a constraint on a union, a
 * default the encoding serializes, a list parameter that may be `null`, and an operation whose name
 * meets a helper's. See `encodingedges.test.ts`, which grades each against the document.
 */
@service(#{ title: "Encoding edges" })
namespace EncodingEdges;

alias Nullable<T> = T | null;

union MaybeTime {
  utcDateTime,
  null,
}

union MaybeDur {
  duration,
  null,
}

scalar Instant extends utcDateTime;

union Moment {
  Instant,
  "now",
}

/** No standard base: openapi3 publishes `{}`, any value. */
scalar Mystery;

union Opt<T> {
  T,
  null,
}

model Filter {
  a: int32;
}

@encode(DateTimeKnownEncoding.unixTimestamp, int32)
scalar Ts extends utcDateTime;

/** Encoded as `Ts` is, through its base: an integer, whatever its constructor's default says. */
scalar Ts2 extends Ts;

@encode(string)
scalar Txt extends int32;

model Body {
  @encode("x", string) twoNulls: Nullable<Nullable<"a">>;
  @encode(DateTimeKnownEncoding.rfc3339) maybeTime: MaybeTime;
  @encode(DurationKnownEncoding.ISO8601) maybeDur: MaybeDur;
  @encode(DateTimeKnownEncoding.rfc7231) httpOrNow: Instant | "now";
  @encode(DateTimeKnownEncoding.rfc7231) moment: Moment;
  @encode("x", int32) mystery: Mystery;
  @encode("x", string) @minLength(2) encodedUnion: string | "a" | null;
  @minLength(2) plainUnion: string | "a" | int32;
  @encode("x", string) opt: Opt<"a">;

  @encode(DateTimeKnownEncoding.unixTimestamp, int32)
  unixDefault?: utcDateTime = utcDateTime.fromISO("2020-01-01T00:00:00Z");

  isoDefault?: utcDateTime = utcDateTime.fromISO("2020-01-01T00:00:00Z");
  @minLength(2) withUnknown: string | unknown;
  ts2Default?: Ts2 = Ts2.fromISO("2020-01-01T00:00:00Z");
  txtDefault?: Txt = 5;
  listDefault?: utcDateTime[] = #[utcDateTime.fromISO("2020-01-01T00:00:00Z")];
}

@route("/body")
@post
op body(@body body: Body): void;

@route("/list")
@get
op list(@query @encode(ArrayEncoding.commaDelimited) ids?: int32[] | null): void;

@route("/cookie")
@get
op cookie(@cookie ids?: int32[], @cookie maybe?: int32[] | null): void;

@route("/record")
@get
op byRecord(@query(#{ explode: true }) rec?: Record<int32> | null): void;

@route("/widget")
@get
@operationId("get-widget")
op getWidget(@query q?: string): void;

/** Its query validator would be `explodedQuery`, the name of the helper that gathers the object. */
@route("/exploded")
@get
op exploded(@query(#{ explode: true }) filter: Filter): void;
