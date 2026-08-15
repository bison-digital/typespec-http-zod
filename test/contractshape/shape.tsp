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
 *
 * **The open models below nest, and one is served as a response.** Both were missing when `0.16.0`
 * answered the second of those by putting the catchall on the type as well. A flat model hides the
 * cost: one spread satisfies an index signature at one level and does not reach a nested one, and a
 * response is where the emitted type stops describing what arrives and starts obliging a producer.
 */
@service(#{ title: "Shape" })
namespace Shape;

/**
 * A required part, an optional one and a repeated one. `multipartSchemaOf` branches on `optional`
 * and on `multi`, and a narrowed part type has to survive both wrappers - `.optional()` and
 * `z.array()` are applied to the refined schema, and either could hand back the unrefined one.
 */
model UploadParts {
  file: HttpPart<File>;
  thumbnail?: HttpPart<File>;
  pages: HttpPart<File>[];
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

/** An open model nested inside another open model - what a single spread cannot reach. */
model OpenChild {
  ...Record<unknown>;
  id: string;
}

model OpenParent {
  ...Record<unknown>;
  code: string;
  child: OpenChild;
}

/** Served as a RESPONSE, so the emitted type is something a producer has to satisfy. */
@route("/n")
@get
op nested(): OpenParent;

model Entry {
  id: string;
}

/**
 * An optional property and two arrays.
 *
 * **Both carry a TypeScript-only property into a wire type if the walk is careless.** `?` on the
 * contract side used to be written `?: T | undefined` to match what `z.infer` of `.optional()`
 * produces - shaping the contract to satisfy an assertion rather than to describe the wire, and JSON
 * has no `undefined`. Arrays are emitted mutable, and a codebase that hands back `readonly T[]`
 * cannot satisfy that; `Produced<>` exists for exactly this and was reachable from nowhere.
 */
model Page {
  entries: Entry[];
  tags: string[];
  note?: string;
}

@route("/p")
@get
op page(): Page;

/** The same model in both directions at once - one type, two roles, which is the hard case. */
@route("/b")
@post
op both(@body body: OpenParent): OpenParent;
