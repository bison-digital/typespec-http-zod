import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "m2" }) namespace M2;
model Inner { @visibility(Lifecycle.Read) id: string; name: string; }
@friendlyName("Wrapper") model Outer { @visibility(Lifecycle.Create) secret: string; inner: Inner; }
@route("/c") @post op create(@body body: Outer): void;
@route("/g") @get op get(): Inner;
