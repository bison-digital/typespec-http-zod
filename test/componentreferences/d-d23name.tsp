import "@typespec/http";
using Http;
@service(#{ title: "d23" })
namespace D23;

@discriminator("kind") model Pet { kind: string; name: string }
model Dog extends Pet { kind: "dog"; @visibility(Lifecycle.Create) secret?: string }
model H { @visibility(Lifecycle.Create) c?: string; pet: Pet }
@route("/a") @post op create(@body body: H): void;
@route("/b") @patch(#{ implicitOptionality: true }) op patchIt(@body body: H): void;
@route("/c") @get op read(): Pet;
