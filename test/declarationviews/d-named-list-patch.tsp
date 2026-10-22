import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "fF" }) namespace FF;
model M14 { d: int8 }
model M13 { a?: M14 }
model M12 { @visibility(Lifecycle.Create) b?: int32 }
model NL is M12[];
model RootB { u: NL }
model LeafB extends RootB { u: M13[] }
@route("/p") @patch(#{ implicitOptionality: true }) op p1(@body body: LeafB): void;
@route("/p") @post op c1(@body body: LeafB): LeafB;
