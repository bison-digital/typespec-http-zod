import "@typespec/http";

using Http;

@service(#{ title: "R5" })
namespace R5;

model F1 { a: int32; }
model F2 { a: int32; b?: string; }

@route("/two") @get op two(@query(#{ explode: true }) f: F1, @query(#{ explode: true }) g: F2): void;
@route("/rm") @get op rm(@query(#{ explode: true }) r: Record<string>, @query(#{ explode: true }) f: F1): void;
@route("/mr") @get op mr(@query(#{ explode: true }) f: F1, @query(#{ explode: true }) r: Record<string>): void;
