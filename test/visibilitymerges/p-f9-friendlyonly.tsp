import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F9" })
namespace F9;

@friendlyName("FooDto")
model Foo { @visibility(Lifecycle.Create) secret: string; name: string; }

@friendlyName("HdrDto")
model Hdr { @header h: string; name: string; }

@route("/g") @get op g(): Foo;
@route("/h") @get op h(): Hdr;
