import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "PQ" })
namespace PQ;

model InnerQ {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterQ {
  @visibility(Lifecycle.Create) secret: string;
  inner: InnerQ;
}
@route("/q?x=1") @post op createQ(@body body: OuterQ): void;
@route("/q") @get op readQ(): InnerQ;
