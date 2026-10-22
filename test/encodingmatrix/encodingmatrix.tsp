import "@typespec/http";

using Http;

/**
 * **`@encode` on every kind of declared type the document can state, in every location.**
 *
 * `@typespec/openapi3`'s `applyEncoding` keeps the schema the property publishes - a `$ref`, an
 * `enum`, a `pattern`, the `anyOf` of a nullable - replaces its `type` with the encoded scalar's,
 * drops `items` unless that is an array, and sets `format`. So the value has to satisfy both the
 * declared type and the encoded scalar. Every kind below is declared in the body and as a query,
 * header, path and cookie parameter - TypeSpec accepts each in each - and `encodingmatrix.test.ts`
 * grades every one against the document and checks that none is missing. `encodingdegenerate.tsp`
 * holds the declarations no value can satisfy.
 *
 * Generated from the table in `encodingmatrix.test.ts`; keep the two in step.
 */
@service(#{ title: "Encoding matrix" })
namespace EncodingMatrix;

@pattern("^[a-z]+$")
scalar Word extends string;

enum Color {
  red,
  blue,
}

union Pick {
  "a",
  "b",
}

model Filter {
  a: int32;
}

/** A date-time whose own check is ISO 8601, encoded at the property as an HTTP-date. */
scalar Instant extends utcDateTime;

@encode(DateTimeKnownEncoding.unixTimestamp, int32)
scalar Ts extends utcDateTime;

/** No `@encode` of its own: it is published as `Ts` is, an integer. */
scalar TsChild extends Ts;

/** A number, which an `int32` encoding narrows to the integers among its values. */
scalar Float extends float32;

model Body {
  @encode(string) int: int32;
  @encode("x", string) word: Word;
  @encode("x", string) color: Color;
  @encode("x", string) pick: Pick;
  @encode("x", string) inline: "a" | "b";
  @encode("x", string) litsnull: "a" | "b" | null;
  @encode("x", string) colornull: Color | null;
  @encode(string) intnull: int32 | null;
  @encode(ArrayEncoding.commaDelimited) list: int32[];
  @encode("x", string) rec: Record<int32>;
  @encode(DateTimeKnownEncoding.unixTimestamp, int32) at: utcDateTime;
  @encode("x", string) mixed: string | int32;
  @encode("x", string) modelor: Filter | string;
  @encode("x", string) spread: { ...Filter };
  @encode(DateTimeKnownEncoding.rfc7231) httpdate: Instant;
  derived: TsChild;
  @encode("x", int32) floatint: Float;
}

@route("/body")
@post
op body(@body body: Body): void;

@route("/query")
@get
op query(
  @query @encode(string) int: int32,
  @query @encode("x", string) word: Word,
  @query @encode("x", string) color: Color,
  @query @encode("x", string) pick: Pick,
  @query @encode("x", string) inline: "a" | "b",
  @query @encode("x", string) litsnull: "a" | "b" | null,
  @query @encode("x", string) colornull: Color | null,
  @query @encode(string) intnull: int32 | null,
  @query @encode(ArrayEncoding.commaDelimited) list: int32[],
  @query @encode("x", string) rec: Record<int32>,
  @query @encode(DateTimeKnownEncoding.unixTimestamp, int32) at: utcDateTime,
  @query @encode("x", string) mixed: string | int32,
  @query @encode("x", string) modelor: Filter | string,
  @query @encode("x", string) spread: { ...Filter },
  @query @encode(DateTimeKnownEncoding.rfc7231) httpdate: Instant,
  @query derived: TsChild,
  @query @encode("x", int32) floatint: Float,
): void;

@route("/header")
@get
op header(
  @header @encode(string) int: int32,
  @header @encode("x", string) word: Word,
  @header @encode("x", string) color: Color,
  @header @encode("x", string) pick: Pick,
  @header @encode("x", string) inline: "a" | "b",
  @header @encode("x", string) litsnull: "a" | "b" | null,
  @header @encode("x", string) colornull: Color | null,
  @header @encode(string) intnull: int32 | null,
  @header @encode(ArrayEncoding.commaDelimited) list: int32[],
  @header @encode("x", string) rec: Record<int32>,
  @header @encode(DateTimeKnownEncoding.unixTimestamp, int32) at: utcDateTime,
  @header @encode("x", string) mixed: string | int32,
  @header @encode("x", string) modelor: Filter | string,
  @header @encode("x", string) spread: { ...Filter },
  @header @encode(DateTimeKnownEncoding.rfc7231) httpdate: Instant,
  @header derived: TsChild,
  @header @encode("x", int32) floatint: Float,
): void;

@route("/cookie")
@get
op cookie(
  @cookie @encode(string) int: int32,
  @cookie @encode("x", string) word: Word,
  @cookie @encode("x", string) color: Color,
  @cookie @encode("x", string) pick: Pick,
  @cookie @encode("x", string) inline: "a" | "b",
  @cookie @encode("x", string) litsnull: "a" | "b" | null,
  @cookie @encode("x", string) colornull: Color | null,
  @cookie @encode(string) intnull: int32 | null,
  @cookie @encode(ArrayEncoding.commaDelimited) list: int32[],
  @cookie @encode("x", string) rec: Record<int32>,
  @cookie @encode(DateTimeKnownEncoding.unixTimestamp, int32) at: utcDateTime,
  @cookie @encode("x", string) mixed: string | int32,
  @cookie @encode("x", string) modelor: Filter | string,
  @cookie @encode("x", string) spread: { ...Filter },
  @cookie @encode(DateTimeKnownEncoding.rfc7231) httpdate: Instant,
  @cookie derived: TsChild,
  @cookie @encode("x", int32) floatint: Float,
): void;

@route("/path/{int}/{word}/{color}/{pick}/{inline}/{litsnull}/{colornull}/{intnull}/{list}/{rec}/{at}/{mixed}/{modelor}/{spread}/{httpdate}/{derived}/{floatint}")
@get
op path(
  @path @encode(string) int: int32,
  @path @encode("x", string) word: Word,
  @path @encode("x", string) color: Color,
  @path @encode("x", string) pick: Pick,
  @path @encode("x", string) inline: "a" | "b",
  @path @encode("x", string) litsnull: "a" | "b" | null,
  @path @encode("x", string) colornull: Color | null,
  @path @encode(string) intnull: int32 | null,
  @path @encode(ArrayEncoding.commaDelimited) list: int32[],
  @path @encode("x", string) rec: Record<int32>,
  @path @encode(DateTimeKnownEncoding.unixTimestamp, int32) at: utcDateTime,
  @path @encode("x", string) mixed: string | int32,
  @path @encode("x", string) modelor: Filter | string,
  @path @encode("x", string) spread: { ...Filter },
  @path @encode(DateTimeKnownEncoding.rfc7231) httpdate: Instant,
  @path derived: TsChild,
  @path @encode("x", int32) floatint: Float,
): void;
