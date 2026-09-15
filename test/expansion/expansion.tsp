import "@typespec/http";

using Http;

/**
 * **Every RFC 6570 form a path or query parameter can take, with the values `@typespec/http-specs`
 * `routes` documents for them:** `"a"`, `["a", "b"]` and `{ a: 1, b: 2 }`. The captured text each
 * test feeds is what its mock server declares the request to be, taken one segment at a time.
 */
@service(#{ title: "Expansion" })
namespace Expansion;

model Filter {
  field: string;
  value: string;
}

@route("/simple/primitive{param}") @get op simplePrimitive(param: string): void;
@route("/simple/array{param}") @get op simpleArray(param: string[]): void;
@route("/simple/record{param}") @get op simpleRecord(param: Record<int32>): void;
@route("/simple/explode/array{param*}") @get op simpleExplodeArray(param: string[]): void;
@route("/simple/explode/record{param*}") @get op simpleExplodeRecord(param: Record<int32>): void;

@route("/path/primitive{/param}") @get op pathPrimitive(param: string): void;
@route("/path/array{/param}") @get op pathArray(param: string[]): void;
@route("/path/record{/param}") @get op pathRecord(param: Record<int32>): void;
@route("/path/explode/array{/param*}") @get op pathExplodeArray(param: string[]): void;
@route("/path/explode/record{/param*}") @get op pathExplodeRecord(param: Record<int32>): void;

@route("/label/primitive{.param}") @get op labelPrimitive(param: string): void;
@route("/label/array{.param}") @get op labelArray(param: string[]): void;
@route("/label/record{.param}") @get op labelRecord(param: Record<int32>): void;
@route("/label/explode/array{.param*}") @get op labelExplodeArray(param: string[]): void;
@route("/label/explode/record{.param*}") @get op labelExplodeRecord(param: Record<int32>): void;

@route("/matrix/primitive{;param}") @get op matrixPrimitive(param: string): void;
@route("/matrix/array{;param}") @get op matrixArray(param: string[]): void;
@route("/matrix/record{;param}") @get op matrixRecord(param: Record<int32>): void;
@route("/matrix/explode/array{;param*}") @get op matrixExplodeArray(param: string[]): void;
@route("/matrix/explode/record{;param*}") @get op matrixExplodeRecord(param: Record<int32>): void;

/** A number inside a label, so the scalar decoding still runs after the expansion is undone. */
@route("/versions{.version}") @get op labelNumber(version: int32): void;

@route("/query/record{?param}") @get op queryRecord(param: Record<int32>): void;
@route("/query/explode/record{?param*}") @get op queryExplodeRecord(param: Record<int32>): void;
@route("/query/explode/model{?param*}") @get op queryExplodeModel(param: Filter): void;

/** A literal query string the route itself carries, continued by a parameter. */
@route("/continuation/primitive?fixed=true{&param}") @get op continuation(param: string): void;

/** The controls: an ordinary whole-segment parameter and an ordinary query list stay as they were. */
@route("/plain/{id}") @get op plain(@path id: string, @query tags: string[]): void;
