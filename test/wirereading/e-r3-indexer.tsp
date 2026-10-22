import "@typespec/http";

using Http;

@service(#{ title: "R3" })
namespace R3;

model Base { ...Record<int32>; }
model Sub extends Base { s?: int32; }

model Base3 { ...Record<int32 | "a">; }
model Sub3 extends Base3 { ...Record<"a">; }

@route("/s")
@get
op s(@query q?: Sub, @header h?: Sub, @query q3?: Sub3, @header h3?: Sub3): void;
