import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "R5" })
namespace R5;

model I2 { @visibility(Lifecycle.Read) id: string; name: string; }
model H2 { @visibility(Lifecycle.Create) s: string; inner: I2; }
union H2OrNull { H2, null }
@route("/2") @post op c2(@body body: H2OrNull): void;
@route("/2") @get op g2(): I2;
