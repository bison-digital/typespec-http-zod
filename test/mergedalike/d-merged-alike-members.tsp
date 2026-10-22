import "@typespec/http";
using Http;

/**
 * `S3` merged under `M1 | M2` is two objects - `M1` holds `c` only where it is created or read, so at
 * `Update` it adds nothing - alike as TypeScript and apart as Zod: one holds `b` to `S3`'s
 * `@minLength` and one to `S3`'s and `M2`'s.
 */
@service(#{ title: "Merged alike members" })
namespace MergedAlike;

enum Color {
  red,
  green,
}
model M1 {
  @visibility(Lifecycle.Create, Lifecycle.Read) c?: Color.green;
}
model M2 {
  @minLength(2) b?: string;
}
model S3 {
  @minLength(2) b?: string;
  g?: string;
}
model RootB {
  u: M1 | M2;
}
model LeafB extends RootB {
  u: S3;
}
@route("/c1") @patch(#{ implicitOptionality: true }) op p1(@body body: LeafB): void;
@route("/c1") @post op c1(@body body: LeafB): LeafB;
