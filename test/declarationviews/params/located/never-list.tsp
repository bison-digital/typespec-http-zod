import "@typespec/http";

using Http;

@service(#{ title: "NeverList" })
namespace NeverList;

@route("/a") @get op a(@query a?: never[]): void;
