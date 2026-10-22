import "@typespec/http";

using Http;

/**
 * A multipart body and a discriminated envelope, the two declarations no TypeSpec type is declared
 * for, named after words TypeScript refuses or after a helper the files declare.
 */
@service(#{ title: "Refused multipart" })
namespace RefusedMultipart;

model `public` {
  note: HttpPart<string>;
}

model Inputs { a: int32; }

@discriminated
union Wire { inputs: Inputs }

@route("/m") @post op m(@header contentType: "multipart/form-data", @multipartBody body: `public`): void;
@route("/w") @post op w(@body body: Wire): Wire;
