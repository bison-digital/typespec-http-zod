import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "T1" })
namespace T1;

model M {
  @visibility(Lifecycle.Create) secret: string;
  name: string;
}
model N {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model Holder {
  @visibility(Lifecycle.Create) s: string;
  pair: [M, N];
}
@route("/h") @post op create(@body body: Holder): void;
@route("/h") @get op get(): Holder;
