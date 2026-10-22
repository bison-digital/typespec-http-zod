import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r7z" }) namespace R7;
model I1 { @visibility(Lifecycle.Read) id: string; name: string; }
model O1 { @visibility(Lifecycle.Create) secret: string; inner: I1; }
model O1Create is Create<R7.O1>;
@route("/a") @post op a(@body body: O1Create): void;
model I2 { @visibility(Lifecycle.Read) id: string; name: string; }
@friendlyName("{name}FBox", T) model FBox<T> { @visibility(Lifecycle.Create) c: string; v: T; }
model FBoxCreate is Create<R7.FBox<R7.I2>>;
@route("/b") @post op b(@body body: FBoxCreate): void;
model I3 { @visibility(Lifecycle.Read) id: string; name: string; }
namespace Sub { model O3 { @visibility(Lifecycle.Create) secret: string; inner: R7.I3; } }
model O3Create is Create<R7.Sub.O3>;
@route("/c") @post op c(@body body: O3Create): void;
@route("/g") @get op g(): { a: I1; b: I2; c: I3 };
