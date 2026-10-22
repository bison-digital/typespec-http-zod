import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "D4" })
namespace D4;

model M {
  @visibility(Lifecycle.Read) id: string;
  name: string;
  ...Record<string>;
}
model Outer {
  @visibility(Lifecycle.Create) secret: string;
  m: M;
}
@route("/o") @post op create(@body body: Outer): void;
@route("/m") @get op get(): M;
