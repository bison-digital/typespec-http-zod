import "@typespec/http";
import "@typespec/openapi3";

using Http;
using OpenAPI;

/**
 * A model named after a helper the files declare, seen through a PATCH: openapi3 publishes its view as
 * `WireReaderUpdate`, a name nothing else in the files holds.
 */
@service(#{ title: "Suffixed helper name" })
namespace SuffixedHelperName;

model Promise { a: string; m?: Record<int32> }
model Readonly extends Promise { b?: int32; @visibility(Lifecycle.Read) id?: string }
model Exclude { r: Readonly[]; p: Promise; t?: Record<Readonly> }
model WireReader { x: Exclude }
model Holder extends WireReader { @encodedName("application/json", "x") xx: { r: Promise[]; p: Readonly } }
@route("/h") @post op c(@body body: Holder): Holder;
@route("/h") @patch(#{ implicitOptionality: true }) op u(@body body: Holder): void;
