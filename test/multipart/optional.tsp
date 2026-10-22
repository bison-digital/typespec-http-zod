import "@typespec/http";

using Http;

/**
 * An optional multipart body beside a required one, and the two single-body controls.
 *
 * The fact is read from the resolved operation, so it is asserted on the IR rather than on emitted
 * text. `typespec-hono/test/optionalmultipart/` makes the same claim at the boundary a consumer
 * writes against; this one keeps `EmittedRoute.bodyProperty` honest for every emitter that reads it,
 * `typespec-http-mcp` included.
 */
@service(#{ title: "Optional multipart IR" })
namespace OptionalMultipartIr;

model Parts {
  note: HttpPart<string>;
}

model Plain {
  note: string;
}

@route("/optional-multipart")
@post
op optionalMultipart(@header contentType: "multipart/form-data", @multipartBody body?: Parts): void;

@route("/required-multipart")
@post
op requiredMultipart(@header contentType: "multipart/form-data", @multipartBody body: Parts): void;

@route("/optional-single")
@post
op optionalSingle(@body body?: Plain): void;

@route("/required-single")
@post
op requiredSingle(@body body: Plain): void;
