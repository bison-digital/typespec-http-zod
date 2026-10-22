import "@typespec/http";
using Http;
@service(#{ title: "d22" })
namespace D22;

model A { @visibility(Lifecycle.Read) id: string; x: string }
model B { @visibility(Lifecycle.Read) id: string; x: string; y?: string }
model Base { m: A }
model Sub extends Base { m: B }
model Req { @visibility(Lifecycle.Create) secret: string; a: A }
model RootU { u: A | int32 }
model SubU extends RootU { u: B }
@route("/a") @post op first(@body body: Req): void;
@route("/b") @get op second(): Sub;
@route("/c") @get op third(): SubU;
