import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "MP4" })
namespace MP4;

model Form { p: HttpPart<int32>; }
@route("/a") @post op up(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
@route("/b") @post op js(@body body: Form): void;
