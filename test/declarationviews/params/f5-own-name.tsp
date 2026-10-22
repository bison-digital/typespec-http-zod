import "@typespec/http";

using Http;

@service(#{ title: "F5" })
namespace F5;

model F {
  x?: int32;
}

model G {
  f?: int32;
}

model H {
  y?: string;
}

@route("/a") @get op a(@query(#{ explode: true }) f?: F): void;
@route("/b") @get op b(@query(#{ explode: true }) f?: F | null): void;
@route("/c") @get op c(@query(#{ explode: true }) f?: G): void;
@route("/d") @get op d(@query(#{ explode: true }) f?: F, @query q?: string): void;
@route("/e") @get op e(@query(#{ explode: true }) f?: F | H): void;
