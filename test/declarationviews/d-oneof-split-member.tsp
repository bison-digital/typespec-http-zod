import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "x27" }) namespace X27;
model S { @visibility(Lifecycle.Read) id: string; name?: string }
model N { c?: string }
@oneOf union O { a: S, b: N }
model Outer { @visibility(Lifecycle.Create) secret?: string; s?: S; o: O }
@route("/o") @post op o(@body body: Outer): void;
@route("/g") @get op g(): Outer;
