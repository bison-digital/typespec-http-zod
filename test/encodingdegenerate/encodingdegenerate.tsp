import "@typespec/http";

using Http;

/**
 * **`@encode` declarations whose published schema no value satisfies, or which states no type.**
 *
 * openapi3 keeps the declared type beside the encoded one, so encoding a model, a list model, an
 * integer enum or a string scalar as a scalar of another JSON type publishes a `$ref` and a `type`
 * that contradict each other, as does `1.5` encoded as an integer and `rfc3339` on a date-time its
 * own scalar already encodes as an integer. `1 | 2 | null` encoded as a string leaves only `null`.
 * Encoding as a scalar that is not standard publishes no `type` at all.
 * Each is refused, so no validator contradicts the document. See `encodingdegenerate.test.ts`.
 */
@service(#{ title: "Encoding degenerate" })
namespace EncodingDegenerate;

alias Nullable<T> = T | null;

/** Encoded as a scalar that is not standard: refused, as a member of a union too. */
@encode("x", Word)
scalar Typeless extends string;

model Filter {
  a: int32;
}

model Tags is string[];

scalar Word extends string;

scalar Instant extends utcDateTime;

enum Level {
  low: 1,
  high: 2,
}

@encode(DateTimeKnownEncoding.unixTimestamp, int32)
scalar Ts extends utcDateTime;

model Body {
  @encode("x", string) filter: Filter;
  @encode(ArrayEncoding.commaDelimited) tags: Tags;
  @encode("x", int32) word: Word;
  @encode("x", string) level: Level;
  @encode(DateTimeKnownEncoding.unixTimestamp, int32) at: Instant;
  @encode("x", Word) text: string;
  @encode("x", string) onlyNull: 1 | 2 | null;
  @encode("x", int32) half: 1.5;
  @encode(DateTimeKnownEncoding.rfc3339) stamp: Ts;
  @encode(string) intTwice: Nullable<int32> | null;
  @encode("x", string) filterDefault?: Filter = #{ a: 1 };
  @minLength(2) withTypeless?: string | Typeless;
}

@route("/body")
@post
op body(@body body: Body): void;

@route("/query")
@get
op query(@query(#{ explode: true }) @encode("x", string) filter: Filter): void;
