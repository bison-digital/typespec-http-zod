import "@typespec/http";

using Http;

/**
 * Multipart bodies, in the shapes that decide whether one is validated at all.
 *
 * `requestBodyOf` returned a type only for `bodyKind === "single"`, so every multipart operation was
 * mounted with **no body validator** — not refused, not diagnosed, silently unchecked.
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
