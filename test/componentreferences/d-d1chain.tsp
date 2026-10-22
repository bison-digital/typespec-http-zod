import "@typespec/http";
using Http;
@service(#{ title: "d1" })
namespace D1;

model A { x: string; y?: int32 }
model B { x: string; z?: string }
model Sub extends A {}

model L0 { @maxLength(5) p: string; m: A; n?: int32 }
model L1 extends L0 { p: "abc" | "abcdefg"; m: B; @maxValue(10) n?: int32 }
model L2 extends L1 { p: "abc"; m: Sub; n?: int8 }

@route("/l2") @post op l2(@body body: L2): L2;
@route("/l1") @post op l1(@body body: L1): L1;
