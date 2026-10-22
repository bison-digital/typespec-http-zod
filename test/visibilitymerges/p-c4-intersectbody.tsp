import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "C4" })
namespace C4;

@discriminator("kind")
model Pet {
  kind: string;
  name: string;
}
model Cat extends Pet {
  kind: "cat";
  meow: boolean;
}
@route("/a") @post op createA(@body body: Pet & {}): void;
@route("/b") @get op getB(): { ...Pet; @visibility(Lifecycle.Create) x: string };
