import "@typespec/http";

using Http;

/** An enum and a union named after words TypeScript refuses. */
@service(#{ title: "Refused enum and union" })
namespace RefusedEnumUnion;
enum `public` { a, b }
union `object` { int32, string }
model Holder { v?: `public`; o?: `object`; }
@route("/a") @post op a(@body body: Holder): Holder;
