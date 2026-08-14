import "@typespec/http";

using Http;

/**
 * **The two walks over one TypeSpec must describe the same shape**, which the emitter asserts about
 * its own output in `wire-contract.gen.ts`. Two constructs made that assertion fail.
 *
 * A `@multipartBody` reached the request type not at all: `requestBodyOf` returns a type only for
 * `bodyKind === "single"`, so the input was the headers and nothing else while the validator beside
 * it had every part. An open model emitted `.loose()` on the Zod side, gaining an index signature,
 * and no catchall on the type side.
 */
@service(#{ title: "Shape" })
namespace Shape;

model UploadParts {
  file: HttpPart<File>;
  alt?: HttpPart<string>;
}

@route("/u")
@post
op upload(@header contentType: "multipart/form-data", @multipartBody body: UploadParts): void;

model OpenRequest {
  ...Record<unknown>;
  code: string;
}

@route("/c")
@post
op complete(@body body: OpenRequest): void;

/** The control: a closed model gains no catchall. */
model ClosedRequest {
  id: string;
}

@route("/d")
@post
op closed(@body body: ClosedRequest): void;
