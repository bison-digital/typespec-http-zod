import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F3" })
namespace F3;

model InnerA {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterA {
  @visibility(Lifecycle.Create) secret: string;
  inner: InnerA;
}
@sharedRoute @route("/a") @post op createA1(@query a: string): void;
@sharedRoute @route("/a") @post op createA2(@query(#{ explode: true }) x: InnerA, @query(#{ explode: true }) a: OuterA): void;
@route("/a") @get op readA(): InnerA;

model InnerB {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterB {
  @visibility(Lifecycle.Create) secret: string;
  inner: InnerB;
}
@sharedRoute @route("/b") @post op createB1(@query a: string, @query(#{ explode: true }) b: OuterB): void;
@sharedRoute @route("/b") @post op createB2(@query(#{ explode: true }) a: InnerB): void;
@route("/b") @get op readB(): InnerB;
