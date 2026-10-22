import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service namespace N;
union A { int32, B }
union B { string, A }
union C { null, C }
@oneOf union D { int32, D }
union E { boolean, A }
union Unreached { int32, Unreached }
model M { a: A; c: C; d: D; e: E }
@route("/a") op a(@body body: M): void;
