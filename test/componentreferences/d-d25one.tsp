import "@typespec/http";
using Http;
@service(#{ title: "d25one" })
namespace D25one;

model M1 { b?: float; c: string }
model S2 { b?: float; c: string }
model RecM1 { ...Record<M1> }
model B { k?: int32 }
model RootU { u: B | RecM1 }
model QX { x: S2 }
model LeafX extends RootU { u: QX }
@route("/x") @patch(#{ implicitOptionality: true }) op px(@body body: LeafX): void;
