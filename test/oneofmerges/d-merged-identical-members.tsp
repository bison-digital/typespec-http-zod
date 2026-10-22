import "@typespec/http";
using Http;

/**
 * `Record<M13>` merged under `M12 | M14` at `Update`, where neither declares anything: two merges of
 * different declarations, alike as the validator writes them.
 */
@service(#{ title: "Merged identical members" })
namespace MergedIdentical;

model M12 {
  @visibility(Lifecycle.Create, Lifecycle.Read) b?: int8;
}
model M14 {
  @visibility(Lifecycle.Create) c: string;
}
model M13 {
  a?: string;
}
model RootV {
  w?: M12 | M14;
}
model LeafV extends RootV {
  w?: Record<M13>;
}
@route("/v") @post op c(@body body: LeafV): LeafV;
@route("/v") @patch(#{ implicitOptionality: true }) op p(@body body: LeafV): void;
