import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F1" })
namespace F1;

union Maybe<T> { T, null }
model A { a: string; }
model B { b: string; }
model Holder { x: Maybe<A>; y: Maybe<B>; }
@route("/x") @get op read(): Holder;
