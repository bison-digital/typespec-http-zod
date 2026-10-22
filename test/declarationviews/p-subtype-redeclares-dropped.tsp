import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "b2" }) namespace B2;
model DBase { @visibility(Lifecycle.Read) id?: string; name: string; }
model IDR extends DBase { id?: string; x: string; }
model Outer { @visibility(Lifecycle.Create) secret: string; v: DBase; }
@route("/o") @post op create(@body body: Outer): void;
@route("/i") @get op get(): IDR;
