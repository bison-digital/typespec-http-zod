import "@typespec/http";
import "@typespec/openapi3";
using Http;

/**
 * Multipart parts the document publishes as a list under a text media type. openapi3 writes
 * `f` exactly as it writes `g` - `{ type: array, items: int32 }` with `contentType: text/plain` -
 * so a lone occurrence of either is the one-element list, however the part was declared.
 */
@service(#{ title: "List parts" })
namespace ListParts;

model Form {
  f?: HttpPart<{
    @header contentType: "text/plain";
    @body body: int32[];
  }>;
  g?: HttpPart<int32>[];
  e?: HttpPart<{
    @header contentType: "text/plain";
    @body body: string[];
  }>;
  h?: HttpPart<{
    @header contentType: "text/plain";
    @body body: int32[] | null;
  }>;
  k?: HttpPart<{
    @header contentType: "text/csv";
    @body body: int32[];
  }>;
  c?: HttpPart<{
    @header contentType: "text/plain" | "application/json";
    @body body: int32[];
  }>;
  /** A JSON part, whose lone occurrence is the list it spells. */
  j?: HttpPart<int32[]>;
}

@route("/f") @post op f(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
