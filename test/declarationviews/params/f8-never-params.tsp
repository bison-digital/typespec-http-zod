import "@typespec/http";

using Http;

@service(#{ title: "F8" })
namespace F8;

model P {
  @query a?: never;
  @query b?: string;
}

@route("/a") @get op a(@query a?: never, @query q?: int32): void;
@route("/b") @get op b(@header h?: never): void;
@route("/c") @get op c(@cookie k?: never): void;
@route("/d") @get op d(...P): void;
@route("/e") @get op e(@query a: never, @header h: never, @cookie k: never, @query q?: int32): void;
@route("/f") @get op f(@query("x") a?: never, @query("x") b?: int32): void;
