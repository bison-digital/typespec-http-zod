import "@typespec/http";

using Http;

@service(#{ title: "R4" })
namespace R4;

model LM { l?: int32[]; }

@route("/lm/{p}")
@get
op lm(@path p: LM, @query q?: LM, @header h?: LM, @cookie c?: LM, @query r?: Record<int32[]>): void;
