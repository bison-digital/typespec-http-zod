import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "U2" })
namespace U2;

union Maybe<T> { T, null }
model Holder {
  a: Maybe<{ x: string }>;
}
@route("/x") @get op read(): Holder;
