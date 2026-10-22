import "@typespec/http";

using Http;

/**
 * **A date-time header is an RFC 7231 HTTP-date unless `@encode` says otherwise.**
 *
 * That is TypeSpec's wire form for one, and `@typespec/openapi3` publishes it as
 * `format: http-date` through `isDateTimeHeader`. This emitter validated it as RFC 3339, so a
 * request sending the header as the document describes was refused with 400, and a handler setting
 * it as an HTTP-date failed its own response contract with 500. Three `@typespec/http-specs`
 * scenarios were refused for it.
 *
 * openapi3's predicate fires only where the header's own schema carries `format: date-time`: the
 * standard scalar, alone or `| null`. A declared scalar is published as a `$ref` and a list's
 * format is on its items, so both stay RFC 3339. Each of those is a row here.
 */
@service(#{ title: "Date-time headers" })
namespace DateTimeHeaders;

scalar Stamp extends utcDateTime;

@route("/request")
@get
op request(
  @header value: utcDateTime,
  @header offset: offsetDateTime,
  @header nullable: utcDateTime | null,
  @header optional?: utcDateTime,
  @header @encode(DateTimeKnownEncoding.rfc7231) explicit: utcDateTime,
  @header @encode(DateTimeKnownEncoding.rfc3339) instant: utcDateTime,
  @header stamp: Stamp,
  @header list: utcDateTime[],
): NoContentResponse;

@route("/response")
@get
op response(): {
  @statusCode _: 204;
  @header value: utcDateTime;
  @header instant: Stamp;
};
