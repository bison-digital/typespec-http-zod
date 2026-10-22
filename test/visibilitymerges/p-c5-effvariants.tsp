import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "C5" })
namespace C5;

@discriminator("kind")
model Pet {
  kind: string;
  name: string;
}
model Cat extends Pet {
  kind: "cat";
  meow: boolean;
}
model Named { ...Pet }
@route("/a") @get op getA(): { @header h: string; ...Pet };
@route("/b") @post op createB(@bodyRoot body: { @header h: string; ...Pet }): void;
@route("/c") @post op createC(@body body: Pet & { @visibility(Lifecycle.Read) r: string }): void;
@route("/d") @get op getD(): Pet & {};
