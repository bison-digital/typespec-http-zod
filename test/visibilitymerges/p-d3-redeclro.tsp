import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "D3" })
namespace D3;

model Base {
  id: string;
}
model Derived extends Base {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model Outer {
  @visibility(Lifecycle.Create) secret: string;
  d: Derived;
}
@route("/o") @post op create(@body body: Outer): void;
@route("/d") @get op get(): Derived;
