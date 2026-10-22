import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "MP3" })
namespace MP3;

model Form4 {
  a: HttpPart<bytes | string>;
  b: HttpPart<bytes>;
  c: HttpPart<bytes | int32>;
}
@route("/z") @post op up(@header contentType: "multipart/form-data", @multipartBody body: Form4): void;
