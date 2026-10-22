import "@typespec/http";
using Http;
@service(#{ title: "d12" })
namespace D12;

@discriminator("kind") model Pet { kind: string; name: string }
model Dog extends Pet { kind: "dog"; @visibility(Lifecycle.Create) secret?: string }
model Sub { p: Dog }
model Node { pet: Pet; next?: Node }

@route("/a") @post op create(@body body: Sub): void;
@route("/b") @get op read(): Node;
