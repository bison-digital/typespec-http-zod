import "@typespec/http";

using Http;

/** A tuple, which openapi3 publishes as `prefixItems` and this emitter refuses. */
@service(#{ title: "Tuple" })
namespace TupleParameter;

@route("/t") @get op t(@query t?: [int32, string]): void;
