import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "U1" })
namespace U1;

union Maybe<T> { T, null }
model Holder {
  a: Maybe<{ x: string }>;
  b: Maybe<{ y: int32 }>;
  c: Maybe<"lit">;
}
@route("/x") @get op read(): Holder;
