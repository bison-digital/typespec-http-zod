import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "b8" }) namespace B8;
model B { @visibility(Lifecycle.Read) k?: string; name: string; }
model S extends B { @visibility(Lifecycle.Read) k?: string; }
model Oc { @visibility(Lifecycle.Create) secret: string; v: S; }
@route("/o") @post op c(@body body: Oc): void;
@route("/s") @get op g(): S;
