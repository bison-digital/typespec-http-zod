import "@typespec/http";

using Http;

@service(#{ title: "F5" })
namespace F5;

model Inner {
  a?: int32 = 1;
  b?: string;
}

model Outer {
  inner?: Inner = #{ b: "x" };
}

@route("/b") @post op b(@body body: Outer): void;
