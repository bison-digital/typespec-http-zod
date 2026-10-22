import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "fI" }) namespace FI;
model M6 { b: string }
model M5 { c?: M6 }
model S8 { x?: int32 }
model S7 { c?: S8 }
model RootB { u: M5 }
model LeafB extends RootB { @encodedName("application/json", "u") uu: S7 }
@route("/p") @patch(#{ implicitOptionality: true }) op p(@body body: LeafB): void;
