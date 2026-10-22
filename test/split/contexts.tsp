import "@typespec/http";
import "@typespec/openapi3";

using Http;

/**
 * One model reached inside an explicit `@body` whose type carries metadata annotations - published
 * with `ignoreMetadataAnnotations` - and outside one: two declarations under one name, which openapi3
 * reports as `duplicate-type-name` and publishes as the one it wrote last.
 */
@service(#{ title: "Contexts" })
namespace Contexts;

/** X1: the request's misreading first, the response's schema last - published as declared. */
model InnerX1 {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterX1 {
  @visibility(Lifecycle.Create) secret: string;
  @header("x-h") hdr: string;
  inner: InnerX1;
}
@route("/x1") @post op createX1(@body body: OuterX1): void;
@route("/x1") @get op readX1(): InnerX1;

/** X2: the response's schema first, the request's misreading last - published split. Refused. */
model InnerX2 {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
model OuterX2 {
  @visibility(Lifecycle.Create) secret: string;
  @header("x-h") hdr: string;
  inner: InnerX2;
}
@route("/x2") @get op readX2(): InnerX2;
@route("/x2") @post op createX2(@body body: OuterX2): void;
