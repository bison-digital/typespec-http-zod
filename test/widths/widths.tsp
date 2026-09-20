import "@typespec/http";

using Http;

/**
 * Every integer width TypeSpec declares, so the emitted validator can be asked whether it enforces
 * the one the document publishes.
 */
@service(#{ title: "Widths" })
namespace Widths;

model Every {
  i8: int8;
  i16: int16;
  i32: int32;
  i64: int64;
  u8: uint8;
  u16: uint16;
  u32: uint32;
  u64: uint64;
  safe: safeint;
}

@route("/widths")
@post
op echo(@body body: Every): Every;

/**
 * **The same widths as query parameters, which is a different code path entirely.**
 *
 * A parameter arrives as text, so the emitter wraps its schema in a decoder that coerces the
 * string first. Which schemas get that decoder is decided by matching the emitted expression
 * against a list of prefixes, and giving each width its own bounds changed nine of those
 * spellings from `z.number()` to `z.int(`, `z.int32(` and `z.uint32(`. Measured: dropping
 * either `z.int(` or `z.uint32(` from that list left all 468 arms here green, while every
 * affected parameter silently stopped accepting the text a caller actually sends.
 *
 * The docblock on that list says a test asserts every numeric entry is recognised. There was
 * no such test, and no fixture had ever declared a width as a parameter.
 */
@route("/params")
@get
op params(
  @query i8: int8,
  @query i16: int16,
  @query i32: int32,
  @query i64: int64,
  @query u8: uint8,
  @query u16: uint16,
  @query u32: uint32,
  @query u64: uint64,
  @query safe: safeint,
  @query plain: integer,
): void;
