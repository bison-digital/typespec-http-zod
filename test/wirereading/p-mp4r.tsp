import "@typespec/http";
using Http;
@service(#{ title: "MP4R" })
namespace MP4R;
model Form { p: HttpPart<int32>; }
@route("/b") @post op js(@body body: Form): void;
@route("/a") @post op up(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
