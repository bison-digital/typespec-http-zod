import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "D1" })
namespace D1;

@discriminator("kind")
model Pet {
  kind: string;
}
model Cat extends Pet {
  kind: "cat";
  @visibility(Lifecycle.Create) secret: string;
}
model Dog extends Pet {
  kind: "dog";
  bark: string;
}
@route("/ping") @get op ping(): void;
