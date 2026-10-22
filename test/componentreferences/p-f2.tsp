import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F2" })
namespace F2;

@route("/a") @post op createA(
  @body body: {
    @visibility(Lifecycle.Read) id: string;
    name: string;
  },
): void;

@route("/b") @post op createB(
  @query(#{ explode: true }) q: {
    @visibility(Lifecycle.Read) id: string;
    name: string;
  },
): void;
