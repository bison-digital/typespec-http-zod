import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "a1" })
namespace A1;

@discriminator("kind") model P { kind: string; }
model K extends P { kind: "c"; @visibility(Lifecycle.Create) s: string; }
model G extends K { g: string; }
@route("/x") @get op x(): void;
