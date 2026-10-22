import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F10" })
namespace F10;

union MaybeN1<T> {
  T,
  null,
}
model ItemN1 {
  name: string;
}
model OutN1 {
  m: MaybeN1<ItemN1>;
}
@route("/n1") @get op readN1(): OutN1;
