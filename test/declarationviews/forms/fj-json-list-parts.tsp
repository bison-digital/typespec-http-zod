import "@typespec/http";
import "@typespec/openapi3";
using Http;

/**
 * Multipart parts the document publishes as a list under JSON, declared both ways: `j` and `r` are
 * published alike, as are `s` and `t`, `ma` and `m`. OAS 3.1 does not say whether such a part is
 * sent once, as the list's JSON, or once per element, so a part reads as either. `u` may be text or
 * JSON, and repeats.
 */
@service(#{ title: "JSON list parts" })
namespace JsonListParts;

model Address {
  city: string;
}

model Form {
  j?: HttpPart<int32[]>;
  r?: HttpPart<{
    @header contentType: "application/json";
    @body body: int32;
  }>[];
  s?: HttpPart<string[]>;
  t?: HttpPart<{
    @header contentType: "application/json";
    @body body: string;
  }>[];
  n?: HttpPart<int32[] | null>;
  ll?: HttpPart<{
    @header contentType: "application/json";
    @body body: int32[];
  }>[];
  m?: HttpPart<Address>[];
  ma?: HttpPart<Address[]>;
  u?: HttpPart<{
    @header contentType: "text/plain" | "application/json";
    @body body: int32;
  }>[];
}

@route("/f") @post op f(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
