import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "p2" }) namespace P2;
model M { @visibility(Lifecycle.Read) id: string; @visibility(Lifecycle.Read) @maxLength(2) code: string; name: string; ...Record<string | int32>; }
model Outer { @visibility(Lifecycle.Create) secret: string; m: M; }
@route("/o") @post op create(@body body: Outer): void;
@route("/m") @get op get(): M;
