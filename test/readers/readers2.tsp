import "@typespec/http";

using Http;

/**
 * Text read where a reading is not the only one: a number in JSON's grammar and nothing looser, a
 * union of shapes, a record or model whose keys name `Object.prototype` or carry their own reader, a
 * list inside an exploded model, a label expansion whose value holds a `.`, and defaults its own
 * keywords rule out.
 */
@service(#{ title: "Readers, the second" })
namespace ReadersTwo;

@pattern("^0")
scalar Zero extends string;

model M {
  a?: int32;
}

model MI {
  a?: int32;
  ...Record<int32>;
}

model MR {
  s?: string;
  k?: "1";
  ...Record<int32 | string>;
}

model Tags {
  tags?: int32[];
}

model Filter {
  a?: int32;
}

@route("/q")
@get
op q(
  @query i?: int32,
  @query lit?: "007" | int32,
  @query zip?: string | int32,
  @query zero?: int32 | Zero,
  @query lsi?: (string | int32)[],
  @query il?: int32 | string[],
  @query im?: int32 | Filter,
  @query m?: M,
  @query mr?: MR,
  @query(#{ explode: true }) @encode(ArrayEncoding.pipeDelimited) xp?: int32[],
): void;

@route("/x")
@get
op x(@query(#{ explode: true }) mi?: MI): void;

@route("/t")
@get
op t(@query(#{ explode: true }) tags?: Tags): void;

@route("/o")
@get
op o(@query(#{ explode: true }) f?: Filter, @query a?: string): void;

@route("/h")
@get
op h(@header m?: M, @header hzip?: string | int32): void;

@route("/c")
@get
op c(@cookie m?: M): void;

@route("/f7{.r*}")
@get
op f7(@path r: Record<float64>): void;

/** Reported as `invalid-default`, each: the value its own keyword refuses is no fallback. */
@route("/d")
@get
op d(
  @query @minValue(10) mv?: int32 = 5,
  @query @maxLength(2) u?: int32 | string = "abc",
  @query @minItems(3) mi?: int32[] = #[1],
): void;
