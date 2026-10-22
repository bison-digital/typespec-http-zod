import "@typespec/http";

using Http;

@service(#{ title: "R2" })
namespace R2;

model Base { x?: int32 | string; }
model Sub extends Base { x?: string; }

@route("/s/{p}")
@get
op s(@path p: Sub, @query q?: Sub, @query(#{ explode: true }) e?: Sub, @header h?: Sub, @cookie c?: Sub): void;
