import "@typespec/http";

using Http;

@service(#{ title: "R6" })
namespace R6;

enum Nums { one: 1, two: 2 }
model Address { city: string; }

model Form {
  na?: HttpPart<Nums | "all">;
  mix?: HttpPart<int32 | Address>;
}

@route("/f")
@post
op f(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
