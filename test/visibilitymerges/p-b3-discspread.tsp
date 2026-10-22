import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "B3" })
namespace B3;

@discriminator("kind")
model Pet {
  kind: string;
  name: string;
}
model Cat extends Pet {
  kind: "cat";
  meow: boolean;
}
model Holder {
  p: { ...Pet };
}
@route("/h") @get op getHolder(): Holder;
@route("/p") @get op getPet(): Pet;
