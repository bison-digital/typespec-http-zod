import "@typespec/http";

using Http;

@service(#{ title: "R8" })
namespace R8;

@encode(DateTimeKnownEncoding.unixTimestamp, int32)
scalar Ts extends utcDateTime;

@encode(DurationKnownEncoding.seconds, int32)
scalar Secs extends duration;

model M {
  ts?: Ts = Ts.fromISO("2020-01-01T00:00:00Z");
  secs?: Secs = Secs.fromISO("PT5S");
}

@route("/m") @post op m(@body body: M): void;
