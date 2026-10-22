import "@typespec/http";

using Http;

@service(#{ title: "R1" })
namespace R1;

model Plain {
  n?: int32;
  b?: boolean;
}

@route("/p")
@post
op p(@header contentType: "application/x-www-form-urlencoded", @body body: Plain): void;
