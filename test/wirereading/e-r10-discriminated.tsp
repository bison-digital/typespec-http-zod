import "@typespec/http";

using Http;

@service(#{ title: "R10" })
namespace R10;

@discriminator("kind")
model Pet { kind: string; }
model PCat extends Pet { kind: "cat"; x: string; }
model PDog extends Pet { kind: "dog"; x: int32; }

@route("/h") @get op h(@header pet?: Pet, @cookie cpet?: Pet): void;
