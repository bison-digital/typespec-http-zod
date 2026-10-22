import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "p6" }) namespace P6;
model B { code: string | int32; }
model D extends B { @visibility(Lifecycle.Read) @maxLength(3) code: string; name: string; }
model Outer { @visibility(Lifecycle.Create) secret: string; d: D; }
@route("/o") @post op create(@body body: Outer): void;
@route("/d") @get op get(): D;
