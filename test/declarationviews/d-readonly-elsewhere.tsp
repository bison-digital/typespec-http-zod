import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "fD" }) namespace FD;
model X { @visibility(Lifecycle.Read) @maxLength(2) id: string; name: string; ...Record<string> }
model Base { id: string }
model Z extends Base { @visibility(Lifecycle.Read) id: "abc"; name: string }
model Base4 { @visibility(Lifecycle.Read) @maxLength(2) id: string; name: string }
model Sub4 extends Base4 { id: string }
@discriminator("kind") model P { @visibility(Lifecycle.Read) @maxLength(1) kind: string; name: string }
model Qq extends P { kind: "qq" }
model Outer { @visibility(Lifecycle.Create) secret?: string; x: X; z: Z; b4: Base4; s: Sub4; p: P }
@route("/o") @post op o(@body body: Outer): void;
@route("/g") @get op g(): Outer;
