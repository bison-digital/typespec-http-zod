import "@typespec/http";

using Http;

/**
 * **A constraint or a default that `@encode` moves onto a JSON type it does not apply to.**
 *
 * openapi3 applies a property's or a scalar's constraints and then lets the encoding replace `type`,
 * so each keyword below is published beside a type JSON Schema does not apply it to, and the
 * document asserts nothing. Applied, `.regex()` on an integer and `.min()` on a boolean threw when
 * the module loaded, and `@minLength` on an integer refused integers the document accepts. A date
 * bound under `unixTimestamp` is the exception: it is a number on the wire, and enforced. See
 * `encodedconstraints.test.ts`.
 */
@service(#{ title: "Encoded constraints" })
namespace EncodedConstraints;

/** A pattern on the scalar, which its own encoding makes an integer. */
@pattern("^[0-9]+$")
@encode("x", int32)
scalar Digits extends string;

enum Color {
  red,
  blue,
}

model Body {
  @encode("x", int32) @pattern("^[0-9]+$") pattern: string;
  @encode("x", int32) @minLength(2) @maxLength(3) length: string;
  @encode(ArrayEncoding.commaDelimited) @minItems(1) @maxItems(2) items: int32[];
  @encode("x", boolean) @minValue(1) flag: int32;
  digits: Digits;
  alsoDigits: Digits;
  @encode(DateTimeKnownEncoding.unixTimestamp, int32)
  @minValue(utcDateTime.fromISO("2020-01-01T00:00:00Z"))
  since: utcDateTime;
  @encode(string) count?: int32 = 5;
  @encode(string) on?: boolean = true;
  @encode("x", string) color?: Color = Color.red;
  @encode(DurationKnownEncoding.ISO8601) iso?: duration;
  plain?: duration;
}

@route("/body")
@post
op body(@body body: Body): void;

@route("/query")
@get
op query(@query digits: Digits, @query @encode("x", int32) @minLength(2) length: string): void;
