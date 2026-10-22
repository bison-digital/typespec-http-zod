import "@typespec/http";
using Http;
@service namespace N;
union string { int32, string }
model M { x: string }
@route("/a") op a(@header contentType: "application/x-www-form-urlencoded", @body body: M): void;
