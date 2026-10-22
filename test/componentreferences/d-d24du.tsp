import "@typespec/http";
using Http;
@service(#{ title: "d24" })
namespace D24;

model Cat { kind: "cat"; meow: int32 }
model Dog { kind: "dog"; bark: string }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union Pet { cat: Cat, dog: Dog }
model H { pet: Pet }
@route("/h") @post op create(@body body: H): H;
@route("/h") @patch(#{ implicitOptionality: true }) op patchIt(@body body: H): void;
