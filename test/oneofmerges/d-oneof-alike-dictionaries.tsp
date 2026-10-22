import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
/**
 * `LeafV`'s `w` at `Update` is the `@oneOf` `O3`, `M14` twice, merged under `M13 | M13`: two members
 * alike, each an open dictionary there. The rest is the generated spec this was found in, cut down
 * to what keeps it so.
 */
@service(#{ title: "oneOf of alike dictionaries" })
namespace AlikeDictionaries;
enum Color { red, green }
@maxLength(2) scalar Short extends string;
@maxValue(5) scalar Small extends int32;
model M9 {  kind: "x"; @maxLength(3) a?: Short; @visibility(Lifecycle.Read) @minValue(1) c?: float32;  e?: int8; }
model M10 {  kind: "y";  c: Small;  d: "a"; @encode("rfc7231") a: utcDateTime; }
model M13 { @visibility(Lifecycle.Read) c: O2; ...Record<unknown>; }
model M14 { @visibility(Lifecycle.Create) c: boolean; ...Record<unknown>; }
model RootV {  v?: M14 | M14;  w?: M13 | M13; }
model LeafV extends RootV { @encodedName("application/json", "v") vv: M14; @encodedName("application/json", "w") ww?: O3; }
model NL1 is string[];
model NL11 is "b"[];
@oneOf union O1 { v0: string, v1: NL11 }
@oneOf union O2 { v0: Color | string, v1: int8 }
@oneOf union O3 { v0: M14, v1: M14 }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union DU8 { x: M9, y: M10 }
@route("/c4") @patch(#{ implicitOptionality: true }) op p4(@body body: LeafV): void;
