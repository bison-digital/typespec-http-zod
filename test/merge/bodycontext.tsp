import "@typespec/http";

using Http;

/**
 * One model inside an explicit `@body`, where its `@header` is data, and as a response, where it is
 * a header: two shapes under one name, which openapi3 refuses as `duplicate-type-name`.
 */
@service(#{ title: "Body context" })
namespace BodyContext;

model Tagged {
  @header("x-code") @maxLength(3) code: string;
  name: string;
}

model Holder {
  t: Tagged;
}

@route("/a") @post op a(@body body: Holder): void;
@route("/b") @get op b(): Tagged;
