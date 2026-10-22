import "@typespec/http";
using Http;
@service(#{ title: "d25same" })
namespace D25same;

model M1 { b?: float; c: string }
model S2 { b?: float; c: string }
model RootA { q: Record<M1> }
model LeafA extends RootA { q: Record<S2> }
model RootL { q: M1[] }
model LeafL extends RootL { q: S2[] }
model RootN { q: M1 }
model LeafN extends RootN { q: S2 }
model RecM1 { ...Record<M1> }
model B { k?: int32 }
model RootU { u: B | RecM1 }
model QX { x: M1 }
model LeafX extends RootU { u: QX }
@route("/a") @patch(#{ implicitOptionality: true }) op pa(@body body: LeafA): void;
@route("/l") @patch(#{ implicitOptionality: true }) op pl(@body body: LeafL): void;
@route("/n") @patch(#{ implicitOptionality: true }) op pn(@body body: LeafN): void;
@route("/x") @patch(#{ implicitOptionality: true }) op px(@body body: LeafX): void;
