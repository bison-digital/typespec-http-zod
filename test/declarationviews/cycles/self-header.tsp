import "@typespec/http";
using Http;
@service namespace N;
union string { int32, string }
@route("/a") op a(@header h: string): void;
