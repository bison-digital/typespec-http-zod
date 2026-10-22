import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "fz130" })
namespace Fz130;
enum Color { red, green }
enum Num { one: 1, two: 2.5 }
@maxLength(2) scalar Short extends string;
@maxValue(5) scalar Small extends int32;
scalar Free;
model M3 {  a?: int8; }
model M1 {  b?: NL2;  e: string | null;  d?: M3; }
model S4 { @visibility(Lifecycle.Create) b: int8[];  e: "a" | "zz" | null;  d?: M3;  f?: Small; }
model RootA {  p: float;  q?: M1;  r?: Color.green; }
model MidA extends RootA {  p: 1.5; }
model LeafA extends MidA {  p: 1.5; @visibility(Lifecycle.Create) q: S4; }
model M5 {  a?: boolean | null; }
model M6 {  d: O1; @visibility(Lifecycle.Create, Lifecycle.Read) c?: O2;  e: string; }
model D7 extends M6 {  d: O3; @visibility(Lifecycle.Create) c?: O4;  e: "a";  f?: boolean; }
model RootB {  u: (M5 | M6)[]; }
model LeafB extends RootB {  u: D7[]; }
model M9 {  a: Color; @minLength(2) b: string; ...Record<unknown>; }
model M10 {  b?: string; @visibility(Lifecycle.Create) a?: Color; }
model M11 { @maxValue(5) d: Small; @minValue(1) a?: float32; }
model M12 {  d?: 1.5; @minValue(1) b: int32;  a: Color; }
model M13 {  d?: "a"; }
model D14 extends M13 {  }
model RootE {  k0: string | null | utcDateTime;  k1?: DU8[]; @visibility(Lifecycle.Create) k2: 1.5 | Color | Small; }
model MidE extends RootE { @encodedName("application/json", "k0") m0: O5 | M13 | M12; }
model LeafE extends MidE { @encodedName("application/json", "k2") @visibility(Lifecycle.Create, Lifecycle.Read) l2?: string;  k1?: NL15; }
@minItems(1) model NL2 is int8[];
model NL15 is DU8[];
@oneOf union O1 { v0: numeric | null, v1: boolean, v2: float32 }
@oneOf union O2 { v0: float32, v1: int32 }
@oneOf union O3 { v0: numeric | null, v1: boolean, v2: float32 }
@oneOf union O4 { v0: float32, v1: int32 }
@oneOf union O5 { v0: utcDateTime, v1: string, v2: Color }
@discriminated(#{ discriminatorPropertyName: "kind" }) union DU8 { x: M9, y: M10, z: M11 }
@route("/c0") @post op c0(@body body: LeafA): LeafA;
@route("/c0") @patch(#{ implicitOptionality: true }) op p0(@body body: LeafA): void;
@route("/c1") @post op c1(@body body: LeafB): LeafB;
@route("/c1") @patch(#{ implicitOptionality: true }) op p1(@body body: LeafB): void;
@route("/c2") @post op c2(@body body: LeafE): LeafE;
@route("/c2") @patch(#{ implicitOptionality: true }) op p2(@body body: LeafE): void;
@route("/g") @get op g(): LeafB;