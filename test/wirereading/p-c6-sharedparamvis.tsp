import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "C6" })
namespace C6;

model FilterA {
  @visibility(Lifecycle.Create) c: string;
  name: string;
}
model CommonF {
  @query(#{ explode: true }) f: FilterA;
}
@sharedRoute @route("/x") @get op listA(@query(#{ explode: true }) f: FilterA): void;
@sharedRoute @route("/x") @get op listB(...CommonF): void;
@route("/y") @post op create(...CommonF): void;
