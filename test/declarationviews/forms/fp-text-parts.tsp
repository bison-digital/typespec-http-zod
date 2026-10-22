import "@typespec/http";
import "@typespec/openapi3";
using Http;

/**
 * Multipart parts a client may send with a filename: every part read from text - JSON, text, or
 * either - and the ones that are not, a file and raw bytes.
 */
@service(#{ title: "Text parts" })
namespace TextParts;

model Address {
  city: string;
}

model Form {
  json?: HttpPart<Address>;
  list?: HttpPart<int32[]>;
  text?: HttpPart<string>;
  number?: HttpPart<int32>;
  either?: HttpPart<int32 | Address>;
  repeated?: HttpPart<Address>[];
  file?: HttpPart<File>;
  raw?: HttpPart<bytes>;
  rawOr?: HttpPart<bytes | int32>;
}

@route("/f") @post op f(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
