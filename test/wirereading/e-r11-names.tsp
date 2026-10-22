import "@typespec/http";

using Http;

@service(#{ title: "R11" })
namespace R11;

model `x-y` { c: string; }
model x_y { d: string; }

@route("/c") @get op c(): `x-y`;
@route("/d") @get op d(): x_y;
