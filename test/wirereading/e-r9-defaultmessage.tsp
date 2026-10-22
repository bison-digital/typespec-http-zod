import "@typespec/http";

using Http;

@service(#{ title: "R9" })
namespace R9;

model M {
  @encode(string) @minValue(5) low?: int32 = 3;
  @encode(string) @minValue(5) high?: int32 = 7;
}

@route("/m") @post op m(@body body: M): void;
