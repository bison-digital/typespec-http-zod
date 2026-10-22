import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "C3b" })
namespace C3b;

model Foo {
  name: string;
}
@route("/f") @get op get(): { @body body: { ...Foo; @header h: string } };
