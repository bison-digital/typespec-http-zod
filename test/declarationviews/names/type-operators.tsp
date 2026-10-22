import "@typespec/http";

using Http;

/** Declarations named after type operators, which do not parse where a type is referred to. */
@service(#{ title: "Type operators" })
namespace TypeOperators;
model `keyof` { a?: int32; }
model `infer` { a?: int32; }
model `readonly` { a?: int32; }
model `unique` { a?: int32; }
model All { p0?: `keyof`; p1?: `infer`; p2?: `readonly`; p3?: `unique`; }
@route("/a") @post op a(@body body: All): All;
