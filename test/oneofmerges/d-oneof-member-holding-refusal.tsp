import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
/**
 * `O3Create` holds `M13Create`, whose `c` is the `M14` openapi3 publishes split, and refused: `M13`
 * is held stricter than the document, so under the `@oneOf` a value both members match was counted
 * once. The rest is the generated spec this was found in, cut down to what keeps it so.
 */
@service(#{ title: "oneOf member holding a refusal" })
namespace HoldingRefusal;
enum Color { red, green }
@maxValue(5) scalar Small extends int32;
model M1 {  a?: string; }
model D5 extends M1 {  }
model M14 {  b: Small; @visibility(Lifecycle.Read) a: string; }
model M13 { @visibility(Lifecycle.Create) c?: M14;  e: Color | string; }
model M15 {  b?: boolean; @visibility(Lifecycle.Create, Lifecycle.Read) c?: Color | null; @visibility(Lifecycle.Update) @pattern("^a") a?: string; }
model M16 { @visibility(Lifecycle.Create) d?: NL17; @maxItems(1) b?: string[]; }
model RootV {  v?: M15 | null;  w?: O3; }
model LeafV extends RootV { @encodedName("application/json", "v") vv?: M16[]; @encodedName("application/json", "w") ww?: M13; }
@minItems(1) model NL7 is true[];
@minItems(1) model NL12 is Color.green[];
model NL17 is string[];
@oneOf union O1 { v0: int8, v1: M1 }
@oneOf union O2 { v0: int8, v1: D5 }
@oneOf union O3 { v0: M16, v1: M13 }
@route("/c4") @post op c4(@body body: LeafV): LeafV;
