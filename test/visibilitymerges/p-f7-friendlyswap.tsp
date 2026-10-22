import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F7" })
namespace F7;

@friendlyName("B")
model A { @visibility(Lifecycle.Create) secret: string; a: string; }
@friendlyName("A")
model B { @visibility(Lifecycle.Create) secret: string; b: int32; }

@route("/a") @post op ca(@body body: A): A;
@route("/b") @post op cb(@body body: B): B;
