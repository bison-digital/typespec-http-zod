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

/**
 * **An encoding declared once on a NAMED scalar, which is where a real spec puts it.**
 *
 * `encodesAsString` reads `@encode` off the property and then off the property's scalar, because
 * a spec that uses a size or an id in twenty places declares the encoding once and names it.
 * Measured: deleting that second lookup left every arm in this package green.
 */
@encode(string)
scalar ByteCount extends int64;

model Encoded {
  /** A comma-delimited list is a STRING on the wire, not an array. */
  @encode(ArrayEncoding.commaDelimited) tags: string[];

  /** Seconds as a float - a number, where the declared type is an ISO 8601 duration string. */
  @encode(DurationKnownEncoding.seconds, float64) elapsed: duration;

  /** Unix time - an integer, where the declared type is an RFC 3339 string. */
  @encode(DateTimeKnownEncoding.unixTimestamp, int64) occurredAt: utcDateTime;

  /** A number sent as a string, which is how a 64-bit value survives JSON. */
  @encode(string) counter: int64;

  /**
   * A bound on a number the wire carries as text. The bound is on the NUMBER: `"42"` satisfies it
   * and is two characters long, so anything that reads it as a length gets the opposite answer.
   */
  @encode(string) @minValue(10) @maxValue(1000) capacity: int32;

  /** An exclusive bound under the same encoding, which Zod has no string form of at all. */
  @encode(string) @minValueExclusive(0) rate: float64;

  /** A length bound on a real string, which is enforced and must stay so. */
  @minLength(2) @maxLength(8) label: string;

  /** The bound lands on a property whose SCALAR carries the encoding, not the property itself. */
  @minValue(1) @maxValue(1000000) size: ByteCount;

  /** And one property with no encoding at all, so the arms below are not all the same case. */
  plain: string;
}

@route("/encoded") op encoded(@body body: Encoded): Encoded;
