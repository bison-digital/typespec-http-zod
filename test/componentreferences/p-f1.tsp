import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F1" })
namespace F1;

// X1: create body first, response after: the response's model expression is the create body's.
model OuterX1 {
  @visibility(Lifecycle.Create) secret: string;
  meta: {
    @visibility(Lifecycle.Read) id: string;
    name: string;
  };
}
@route("/x1") @post op createX1(@body body: OuterX1): void;
@route("/x1") @get op readX1(): OuterX1;

// X2: response first, create body after: the create body's model expression is the response's.
model OuterX2 {
  @visibility(Lifecycle.Create) secret: string;
  meta: {
    @visibility(Lifecycle.Read) id: string;
    name: string;
  };
}
@route("/x2") @get op readX2(): OuterX2;
@route("/x2") @post op createX2(@body body: OuterX2): void;
