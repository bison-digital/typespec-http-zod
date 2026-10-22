import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "w5" }) namespace W5;
model M19 { @visibility(Lifecycle.Read, Lifecycle.Update) e: string; }
model RootV { w?: Record<M19>; }
model LeafV extends RootV { @encodedName("application/json", "w") ww?: M19 | M19; }
@route("/c4") @post op c4(@body body: LeafV): LeafV;
