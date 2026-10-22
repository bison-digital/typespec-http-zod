import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "b1" }) namespace B1;
model RBase { @visibility(Lifecycle.Read) id: string; }
model IRB extends RBase { @visibility(Lifecycle.Read) id: string; name: string; }
model Outer { @visibility(Lifecycle.Create) secret: string; v: IRB; }
@route("/o") @post op create(@body body: Outer): void;
@route("/i") @get op get(): IRB;
