import "@typespec/http";

using Http;

/**
 * Identifiers carrying a `$`, which is legal in TypeSpec and in JavaScript and is an anchor in a
 * regular expression.
 *
 * Deciding which imports an emitted file needs by matching a pattern built from each name reported
 * every one of these absent, so `typespec-hono` emitted a file that imported nothing and did not
 * compile. `list$Item` is here as a prefix of `list$Items` so that equality is doing the work rather
 * than a substring, and `$type` because OData-style APIs carry those throughout.
 */
@service(#{ title: "dollar identifiers" })
namespace DollarIdentifiers;

enum Item$Kind {
  alpha: "alpha",
  beta: "beta",
}

model Item$Ref {
  id: string;
  kind: Item$Kind;
  `$type`: string;
}

@route("/item")
@get
op list$Item(@query `$select`?: string): Item$Ref;

@route("/items")
@get
op list$Items(@query `$filter`?: string): Item$Ref[];
