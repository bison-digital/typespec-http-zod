import "@typespec/http";
import "@typespec/openapi3";
using Http;

/**
 * Text parts of a union holding a list: one value, or several sent as as many parts, read as a
 * URL-encoded form's field is. `h` and `k` may be text or JSON as well.
 */
@service(#{ title: "Text union lists" })
namespace TextUnionLists;

model Form {
  g?: HttpPart<{
    @header contentType: "text/plain";
    @body body: int32 | int32[];
  }>;
  l?: HttpPart<{
    @header contentType: "text/plain";
    @body body: int32[] | string[];
  }>;
  n?: HttpPart<{
    @header contentType: "text/plain";
    @body body: int32 | int32[] | null;
  }>;
  h?: HttpPart<int32 | int32[]>;
  k?: HttpPart<int32 | string[]>;
}

@route("/f") @post op f(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
