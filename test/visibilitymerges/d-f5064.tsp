import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "fz5064" })
namespace Fz5064;
enum Color { red, green }
@maxLength(2) scalar Short extends string;
@maxValue(5) scalar Small extends int32;
scalar Free;
model M3 { @visibility(Lifecycle.Create) e: int32; @maxLength(3) a?: Short;  c: utcDateTime; }
model RootA {  p: NL1;  q?: unknown;  r?: Color; }
model MidA extends RootA { @visibility(Lifecycle.Create, Lifecycle.Read) p: NL2; }
model LeafA extends MidA {  p: Short[];  q: M3[]; }
model M4 { @visibility(Lifecycle.Create) e?: int8;  d: string[];  c: Color; }
model M6 { @visibility(Lifecycle.Read) c: boolean; }
model M5 {  e: M6; @visibility(Lifecycle.Create) b?: float32; }
model RootB {  u: NL7; }
model LeafB extends RootB {  u: M5[]; }
model NL1 is Short[];
@minItems(1) model NL2 is Short[];
model NL7 is (M4 | M5)[];
@route("/c0") @post op c0(@body body: LeafA): LeafA;
@route("/c0") @patch(#{ implicitOptionality: true }) op p0(@body body: LeafA): void;
@route("/c1") @post op c1(@body body: LeafB): LeafB;
@route("/c1") @patch(#{ implicitOptionality: true }) op p1(@body body: LeafB): void;