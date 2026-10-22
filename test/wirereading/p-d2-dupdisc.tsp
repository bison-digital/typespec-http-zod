import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "D2" })
namespace D2;

@discriminator("kind")
model Pet {
  kind: string;
}
model Cat extends Pet {
  kind: "cat";
  @header h: string;
  name: string;
}
model Dog extends Pet {
  kind: "dog";
}
model Env {
  @header x: string;
  cat: Cat;
}
@route("/a") @post op a(@body body: Env): void;
@route("/c") @get op c(): Pet;
