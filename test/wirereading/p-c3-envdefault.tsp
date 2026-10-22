import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "C3" })
namespace C3;

model Cat { meow: int32; }
model Dog { bark: string; }
model Other { kind: "other"; x: string; }
@discriminated
union Pet { cat: Cat, dog: Dog, Other }
@route("/x") @get op read(): Pet;
