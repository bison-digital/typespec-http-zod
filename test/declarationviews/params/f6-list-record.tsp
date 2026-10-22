import "@typespec/http";

using Http;

@service(#{ title: "F6" })
namespace F6;

model G {
  x?: int32;
  y?: string;
}

@route("/a") @get op a(@query(#{ explode: true }) x?: int32[] | Record<int32>): void;
@route("/b") @get op b(@query(#{ explode: true }) x?: Record<int32> | string[]): void;
@route("/c") @get op c(@query(#{ explode: true }) x?: int32 | int32[] | Record<int32>): void;
@route("/d") @get op d(@query(#{ explode: true }) x?: string[] | Record<int32>): void;
@route("/e") @get op e(@query(#{ explode: true }) x?: int32[] | G, @query q?: string): void;
