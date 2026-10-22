import "@typespec/http";

using Http;

@service(#{ title: "F4" })
namespace F4;

model WireReader { value: string; }

@route("/a") @post op a(@body body: WireReader): void;
@route("/h") @get op h(@header rec?: Record<int32>): void;
