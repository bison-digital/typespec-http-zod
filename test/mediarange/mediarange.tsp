import "@typespec/http";

using Http;

/**
 * **A declared media RANGE, in the two spellings a real spec uses.**
 *
 * Both come from consumers rather than from imagination. `copal-gateway` declares the full
 * wildcard on its file upload, and it is the only full wildcard anywhere in the fleet;
 * `bison-post` declares the `text` group across four responses. A range reached the emitted
 * header validator as a literal, so the only request that satisfied it was one sending the
 * range's own text as its `Content-Type`, which no client does.
 */
@service(#{ title: "Media range" })
namespace MediaRange;

/** The full wildcard: every media type is inside it. */
model AnyUpload {
  @header contentType: "*/*";
  @body content: bytes;
}

/** A subtype wildcard: the `text` group and nothing else. */
model TextUpload {
  @header contentType: "text/*";
  @body content: string;
}

/** A concrete type, which must go on admitting only itself. */
model JsonUpload {
  @header contentType: "application/json";
  @body content: Thing;
}

model Thing {
  label: string;
}

@route("/any") @put op putAny(...AnyUpload): void;
@route("/text") @put op putText(...TextUpload): void;
@route("/json") @put op putJson(...JsonUpload): void;
