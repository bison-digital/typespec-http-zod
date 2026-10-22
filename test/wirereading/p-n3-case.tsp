import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "N3" })
namespace N3;

model Foo { a: string; }
model foo { b: int32; }
model Holder { x: Foo; y: foo; }
@route("/x") @get op read(): Holder;
