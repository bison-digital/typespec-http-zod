import "@typespec/http";

using Http;

@service(#{ title: "F2" })
namespace F2;

model A { kind: "a"; n?: int32; }
model B { kind: "b"; m?: boolean; }

@route("/u") @post op u(@header contentType: "application/x-www-form-urlencoded", @body body: A | B): void;
@route("/n") @post op n(@header contentType: "application/x-www-form-urlencoded", @body body: A | null): void;
