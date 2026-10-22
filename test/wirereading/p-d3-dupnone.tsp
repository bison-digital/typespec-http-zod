import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "D3" })
namespace D3;

model Cat {
  kind: "cat";
  @header h: string;
  name: string;
}
model Dog {
  kind: "dog";
}
@discriminated(#{ envelope: "none" })
union Pet { cat: Cat, dog: Dog }
model Env {
  @header x: string;
  cat: Cat;
}
@route("/a") @post op a(@body body: Env): void;
@route("/c") @get op c(): Pet;
