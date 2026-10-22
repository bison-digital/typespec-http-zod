import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;

/**
 * `@oneOf` bodies sent as a URL-encoded form whose members may read a key's text two ways - as
 * itself and as the number or boolean it spells - each refused as `ambiguous-form-reading`.
 */
@service(#{ title: "Ambiguous oneOf forms" })
namespace AmbiguousOneOfForms;

model M {
  x?: int32 | string;
}
model N {
  x?: int32;
}
@oneOf union U {
  M,
  N,
}

model L {
  x?: int32 | "5";
}
@oneOf union X {
  L,
  N,
}

model R {
  ...Record<int32 | string>;
}
@oneOf union Y {
  R,
  N,
}

/** `k` is required, but `KN` reads it as `KM` does, so `KN`'s reading matches both. */
model KM {
  x?: int32 | string;
  k: "m";
}
model KN {
  x?: int32;
  k?: string;
}
@oneOf union K {
  KM,
  KN,
}

@route("/k") @post op k(@header contentType: "application/x-www-form-urlencoded", @body body: K): void;
@route("/u") @post op u(@header contentType: "application/x-www-form-urlencoded", @body body: U): void;
@route("/x") @post op x(@header contentType: "application/x-www-form-urlencoded", @body body: X): void;
@route("/y") @post op y(@header contentType: "application/x-www-form-urlencoded", @body body: Y): void;
