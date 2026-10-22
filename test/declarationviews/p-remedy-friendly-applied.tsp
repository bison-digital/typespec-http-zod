import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "m2z" }) namespace M2;
model Inner { @visibility(Lifecycle.Read) id: string; name: string; }
@friendlyName("Wrapper") model Outer { @visibility(Lifecycle.Create) secret: string; inner: Inner; }
model OuterCreate is Create<M2.Outer>;
@route("/c") @post op create(@body body: OuterCreate): void;
@route("/g") @get op get(): Inner;
