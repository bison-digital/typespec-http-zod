import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "r7" }) namespace R7;
model I1 { @visibility(Lifecycle.Read) id: string; name: string; }
model O1 { @visibility(Lifecycle.Create) secret: string; inner: I1; }
@route("/a") @post op a(...O1): void;
model I2 { @visibility(Lifecycle.Read) id: string; name: string; }
@friendlyName("{name}FBox", T) model FBox<T> { @visibility(Lifecycle.Create) c: string; v: T; }
@route("/b") @post op b(@body body: FBox<I2>): void;
model I3 { @visibility(Lifecycle.Read) id: string; name: string; }
namespace Sub { model O3 { @visibility(Lifecycle.Create) secret: string; inner: R7.I3; } }
@route("/c") @post op c(@body body: Sub.O3): void;
@route("/g") @get op g(): { a: I1; b: I2; c: I3 };
