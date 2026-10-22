import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "N5" })
namespace N5;

@friendlyName("Dog")
model Cat { meow: int32; }
@friendlyName("Cat")
model Dog { bark: string; }
model Pets { a: Cat; b: Dog; }
@route("/x") @get op read(): Pets;
