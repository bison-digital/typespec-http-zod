import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "C8" })
namespace C8;

model Inner { name: string; }
model Form3 {
  either: HttpPart<bytes | Inner>;
}
@route("/z") @post op upload3(@header contentType: "multipart/form-data", @multipartBody body: Form3): void;
union FileOrInner { bytes, Inner }
@route("/j") @post op json(@body body: FileOrInner): void;
model Form2 {
  either: HttpPart<FileOrInner>;
}
@route("/m") @post op upload2(@header contentType: "multipart/form-data", @multipartBody body: Form2): void;
