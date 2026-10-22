import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
/**
 * `O1Create` holds `M10`, which openapi3 publishes split - first reached from the create body of
 * `c2`, its `required` read at `Read` - and which is refused only as it is written, while the
 * `@oneOf` holding it is. The rest is the generated spec this was found in, cut down to what keeps
 * `O1Create` written before `M10` is refused.
 */
@service(#{ title: "oneOf member refused as written" })
namespace RefusedAsWritten;
enum Color { red, green }
model M10 { @visibility(Lifecycle.Read) d: "a"; @visibility(Lifecycle.Update) @minValue(1) e?: float;  a: Color; }
model M11 {  e?: boolean; @visibility(Lifecycle.Create) @minValue(1) d?: numeric; }
@discriminator("kind") model M12 {  c?: Color.green;  a?: Color;  e: 1.5;  kind: string; }
model M16 {  kind: "x";  a: float32; }
model M17 {  kind: "y";  d: 2;  a: Color.green; }
model M18 {  kind: "z";  d?: boolean; @visibility(Lifecycle.Create, Lifecycle.Read) e: 1; ...Record<unknown>; }
model RootE {  k0: NL9; @visibility(Lifecycle.Create) k1?: O1; @visibility(Lifecycle.Update) k2?: string; }
model MidE extends RootE { @encodedName("application/json", "k0") @visibility(Lifecycle.Read) m0?: M12 | float | DU15; }
model LeafE extends MidE { @encodedName("application/json", "k2") @visibility(Lifecycle.Create) l2?: "a"; }
model M19 {  a: Color;  b: utcDateTime | null; ...Record<unknown>; }
model M20 { @visibility(Lifecycle.Update) c: Color.green;  a: Color | null; }
model NL9 is [Color, Color][];
@oneOf union O1 { v0: float, v1: M10, v2: M11 }
@oneOf union O2 { v0: 1, v1: 2 }
@oneOf union O3 { v0: M19, v1: M20 }
@oneOf union O4 { v0: M20, v1: M19 }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union DU15 { x: M16, y: M17, z: M18 }
@route("/c2") @post op c2(@body body: LeafE): LeafE;
