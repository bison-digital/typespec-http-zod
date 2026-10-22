import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

/**
 * Parameters the wire carries as text, whose schema says what the text means: numeric enums, a
 * number beside a boolean or beside a string literal, and records and models in every location.
 */
@service(#{ title: "Readers" })
namespace Readers;

enum Color {
  a: "a",
  bb: "bb",
}

enum Nums {
  one: 1,
  two: 2,
}

union MaybeInt {
  int32,
  null,
}

@encode(DateTimeKnownEncoding.unixTimestamp, int32)
scalar Ts extends utcDateTime;

model QF {
  qa?: int32;
  qb?: boolean;
  qn?: Nums;
}

model Fields {
  a?: int32;
  b?: string;
}

@route("/q")
@get
op q(
  @query n?: int32 | null,
  @query b?: boolean | null,
  @query e?: Color | null,
  @query ne?: Nums | null,
  @query neBare?: Nums,
  @query lit?: "x" | "y" | null,
  @query nlit?: 1 | 2 | null,
  @query blit?: true | null,
  @query ts?: Ts | null,
  @query mi?: MaybeInt,
  @query ib?: int32 | boolean,
  @query inum?: int32 | Nums,
  @query limit?: int32 | "all",
  @query either?: uint8 | string,
  @query arrNum?: Nums[] | null,
  @query rec?: Record<int32> | null,
  @query fields?: Fields | null,
  @query(#{ explode: true }) qf?: QF | null,
): void;

@route("/h")
@get
op h(
  @header n?: int32 | null,
  @header ne?: Nums | null,
  @header nlit?: 1 | 2 | null,
  @header mi?: MaybeInt,
  @header(#{ explode: true }) ids?: int32[],
  @header rec?: Record<int32> | null,
  @header(#{ explode: true }) recx?: Record<int32>,
): void;

@route("/c")
@get
op c(
  @cookie n?: int32 | null,
  @cookie ne?: Nums | null,
  @cookie mi?: MaybeInt,
  @cookie ids?: int32[] | null,
  @cookie rec?: Record<int32> | null,
  @cookie fields?: Fields,
): void;

@route("/p/{n}/{ne}/{mi}/{rec}")
@get
op p(@path n: int32 | null, @path ne: Nums | null, @path mi: MaybeInt, @path rec: Record<int32> | null): void;

/** An operation id holding the characters that close a block comment. */
@route("/g") @get @operationId("list*/items") op g(@query q?: int32): void;
