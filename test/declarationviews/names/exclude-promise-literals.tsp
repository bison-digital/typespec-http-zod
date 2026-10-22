import "@typespec/http";

using Http;

@service(#{ title: "Exclude and Promise literals" })
namespace ExcludePromiseLiterals;

model Exclude { a?: int32; }
model Promise { a?: int32; }
model M { d?: string = "Exclude<y>"; l?: "Promise<z>"; }
@route("/a") @post op a(@body body: M, @header h?: "Promise<h>"): Exclude;
