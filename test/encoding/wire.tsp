import "@typespec/http";

using Http;

/**
 * `@encode`, in the five shapes it changes the wire type.
 *
 * A decorator is a declaration, not a behaviour: it attaches metadata and every emitter has to go
 * and ask. `@typespec/openapi3` asks, so the document publishes the ENCODED type - and this emitter
 * validated the DECLARED one, so a body carrying exactly what the contract describes came back 400.
 */
@service(#{ title: "encoding" })
namespace Encoding;

model Encoded {
  /** A comma-delimited list is a STRING on the wire, not an array. */
  @encode(ArrayEncoding.commaDelimited) tags: string[];

  /** Seconds as a float - a number, where the declared type is an ISO 8601 duration string. */
  @encode(DurationKnownEncoding.seconds, float64) elapsed: duration;

  /** Unix time - an integer, where the declared type is an RFC 3339 string. */
  @encode(DateTimeKnownEncoding.unixTimestamp, int64) occurredAt: utcDateTime;

  /** A number sent as a string, which is how a 64-bit value survives JSON. */
  @encode(string) counter: int64;

  /** And one property with no encoding at all, so the arms below are not all the same case. */
  plain: string;
}

@route("/encoded") op encoded(@body body: Encoded): Encoded;
