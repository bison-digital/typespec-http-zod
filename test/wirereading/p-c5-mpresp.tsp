import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "C5" })
namespace C5;

model Inner { @visibility(Lifecycle.Read) id: string; name: string; }
model Form {
  plain: HttpPart<Inner>;
  note: HttpPart<string>;
}
@route("/x") @post op upload(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
@route("/y") @get op download(): { @header contentType: "multipart/form-data"; @multipartBody body: Form };
union FileOrInner { bytes, Inner }
model Form2 {
  either: HttpPart<FileOrInner>;
}
@route("/z") @post op upload2(@header contentType: "multipart/form-data", @multipartBody body: Form2): void;
