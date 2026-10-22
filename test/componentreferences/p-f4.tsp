import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F4" })
namespace F4;

model TagR1 {
  name: string;
}
model TagsR1 is TagR1[];
model MidR1 {
  tags: TagsR1;
}
model HolderR1 {
  @visibility(Lifecycle.Create) secret: string;
  mid: MidR1;
}
@route("/r1") @post op createR1(@body body: HolderR1): void;
@route("/r1") @get op readR1(): MidR1;
@route("/r1/tags") @get op listR1(): TagsR1;

union MaybeR2<T> {
  T,
  null,
}
model ItemR2 {
  name: string;
}
model MidR2 {
  m: MaybeR2<ItemR2>;
}
model HolderR2 {
  @visibility(Lifecycle.Create) secret: string;
  mid: MidR2;
}
@route("/r2") @post op createR2(@body body: HolderR2): void;
@route("/r2") @get op readR2(): MidR2;
