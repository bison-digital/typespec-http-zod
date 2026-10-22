import "@typespec/http";

using Http;

/**
 * Two services, so `seal-object-schemas` can be set per service.
 *
 * **`@typespec/openapi3` has no per-service options.** It answers the same question about the same
 * models with ONE value for the whole program, so a per-service value that differs from the
 * top-level one produces a document that disagrees with the validator beside it - which is exactly
 * what the option's own docblock warns about, and the reason it says "set this to whatever
 * `@typespec/openapi3`'s `seal-object-schemas` is set to".
 */
@service(#{ title: "Alpha" })
namespace Alpha {
  model Thing {
    id: string;
  }

  @route("/a")
  @get
  op a(): Thing;
}

@service(#{ title: "Beta" })
namespace Beta {
  model Other {
    id: string;
  }

  @route("/b")
  @get
  op b(): Other;
}
