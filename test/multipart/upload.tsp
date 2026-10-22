import "@typespec/http";

using Http;

/**
 * Multipart bodies, in the shapes that decide whether one is validated at all.
 *
 * `requestBodyOf` returned a type only for `bodyKind === "single"`, so every multipart operation was
 * mounted with **no body validator** - not refused, not diagnosed, silently unchecked.
 */
@service(#{ title: "multipart" })
namespace Multipart;

model Address {
  city: string;
}

model Upload {
  /** A plain text part: the document publishes its type, so it is enforced. */
  id: HttpPart<string>;

  /** A binary part: the document publishes `{}`, so nothing may be enforced about it. */
  profileImage: HttpPart<bytes>;

  /** A JSON part references the model, so the part's contents ARE checked. */
  address: HttpPart<Address>;

  /** Repeated parts arrive as an array. */
  pictures: HttpPart<bytes>[];

  /** And an optional one, so requiredness is not uniform. */
  caption?: HttpPart<string>;
}

/** Wire names differ from the property names, exactly as `@encodedName` does for JSON. */
model Renamed {
  identifier: HttpPart<string, #{ name: "id" }>;
}

@post @route("/upload") op upload(@header contentType: "multipart/form-data", @multipartBody body: Upload): void;
@post @route("/renamed") op renamed(@header contentType: "multipart/form-data", @multipartBody body: Renamed): void;

/**
 * **Parts that mean numbers and booleans, which a form still carries as text.** `c.req.parseBody()`
 * hands a text part over as a string, and `payload/multipart/non-string-float` in `@typespec/http-specs`
 * documents exactly this request: a `text/plain` part whose value is `0.5`. `z.number()` refused it.
 */
model Measurements {
  temperature: HttpPart<{
    @body body: float64;
    @header contentType: "text/plain";
  }>;
  count: HttpPart<int32>;
  flag: HttpPart<boolean>;
}

@post @route("/measurements") op measurements(@header contentType: "multipart/form-data", @multipartBody body: Measurements): void;

/**
 * **Parts whose media type is JSON, which a form also carries as text.** `@typespec/http` resolves
 * `application/json` for a model or array part, and a client writes the part as JSON text with that
 * `Content-Type` and no filename, so `c.req.parseBody()` hands it over as a string.
 */
model Profile {
  name: HttpPart<string>;
  address: HttpPart<Address>;
  scores: HttpPart<int32[]>;

  /** A JSON part whose schema admits a string, so malformed JSON text must be refused as JSON. */
  note: HttpPart<{
    @body body: string;
    @header contentType: "application/json";
  }>;
}

@post @route("/profiles") op profile(@header contentType: "multipart/form-data", @multipartBody body: Profile): void;
