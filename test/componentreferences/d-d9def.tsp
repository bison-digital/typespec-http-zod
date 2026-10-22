import "@typespec/http";
using Http;
@service(#{ title: "d9" })
namespace D9;

@maxValue(3) scalar small extends int32;

model A { k?: int32 = 5; x: string }
model B { @maxValue(3) k?: int32; x: string }
model M2 { m: B }
model M3 extends M2 { m: A }

model Inner1 { a: string; b?: string }
model Inner2 { a: string; c?: string }
model D0 { i?: Inner1 }
model D1 extends D0 { i?: Inner2 = #{ a: "x", c: "z" } }

model KB { @maxLength(3) k: string }
model KS extends KB { k: string }
model DD { o?: KS = #{ k: "toolong" } }

model Wrap { inner: KS }
model DD2 { o?: Wrap = #{ inner: #{ k: "toolong" } } }

model LB { @maxItems(1) l: string[] }
model LS extends LB { l: string[] }
model DL { o?: LS = #{ l: #["a", "b"] } }

@route("/m3") @post op m3(@body body: M3): void;
@route("/d1") @post op d1(@body body: D1): void;
@route("/dd") @post op dd(@body body: DD): void;
@route("/dl") @post op dl(@body body: DL): void;
@route("/dd2") @post op dd2(@body body: DD2): void;
