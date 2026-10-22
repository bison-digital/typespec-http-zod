import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
/**
 * `DU7` is published at `Create` and at `Update | Patch` under its one name, refused as
 * `duplicate-declaration`, and its envelopes `DU7X`, `DU7Y`, `DU7Z` with it: openapi3 keeps the PATCH
 * view of each, `kind` and `value` optional. Cut down from the generated spec this was found in.
 */
@service(#{ title: "Envelopes of a refused union" })
namespace RefusedEnvelopes;
enum Color { red, green }
model M5 {  c?: Color | null; }
model M6 {  b: int32;  d: Color; }
model M8 {  e?: 1.5 = 1.5; @visibility(Lifecycle.Create) a?: 1 = 1;  d?: int32; }
model M9 {  d: string;  a?: Color = Color.red;  b: string; }
model M10 {  b: Color.red; }
model M11 {  b: int32; @visibility(Lifecycle.Read) d: "a";  e: boolean; }
model RootE { @visibility(Lifecycle.Read, Lifecycle.Update) @maxLength(3) k0: string;  k1?: [DU7, Color.green | float | string]; @visibility(Lifecycle.Read, Lifecycle.Update) k2: M11; }
model MidE extends RootE { @encodedName("application/json", "k0") m0?: "abcd" = "abcd"; }
model LeafE extends MidE { @encodedName("application/json", "k2") l2: numeric[]; }
model NL12 is 1.5[];
@oneOf union O1 { v0: M5, v1: M6 }
@discriminated(#{ discriminatorPropertyName: "kind" }) union DU7 { x: M8, y: M9, z: M10 }
@route("/c2") @patch(#{ implicitOptionality: true }) op p2(@body body: LeafE): void;
