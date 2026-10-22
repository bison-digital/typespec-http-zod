import "@typespec/http";
using Http;
@service namespace N;
union string { int32, string }
@route("/a/{p}") op a(@path p: string): void;
