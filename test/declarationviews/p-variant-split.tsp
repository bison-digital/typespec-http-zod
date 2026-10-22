import "@typespec/http";
import "@typespec/openapi3";
import "@typespec/openapi";
using Http;
using OpenAPI;
@service(#{ title: "v1" }) namespace V1;
model Inner { @visibility(Lifecycle.Read) id: string; name: string; }
union U { a: Inner, b: string }
model Outer { @visibility(Lifecycle.Create) secret: string; x: U.a; }
@route("/o") @post op create(@body body: Outer): void;
@route("/i") @get op get(): Inner;
