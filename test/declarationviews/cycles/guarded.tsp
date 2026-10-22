import "@typespec/http";
using Http;
@service namespace N;
union A { int32, A[] }
union B { int32, { x?: B } }
@discriminated union C { a: C, b: { n: int32 } }
union R { int32, Record<R> }
model M { a: A; b: B; c: C; r: R }
@route("/a") op a(@body body: M, @query q?: A, @header h?: A): void;
union G { int32, Env }
@discriminated union Env { g: G }
model H { g: G }
@route("/h") op h(@body body: H): void;
