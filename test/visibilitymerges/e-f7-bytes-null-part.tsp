import "@typespec/http";

using Http;

@service(#{ title: "F7" })
namespace F7;

model Form { bn?: HttpPart<bytes | null>; un?: HttpPart<unknown>; }

@route("/p") @post op p(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
