import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F9" })
namespace F9;

model FilterA {
  @visibility(Lifecycle.Create) c: string;
  name: string;
}
model CommonA {
  @query(#{ explode: true }) f: FilterA;
}
@route("/a") @get op listA(...CommonA): void;
@route("/a") @post op createA(...CommonA): void;
