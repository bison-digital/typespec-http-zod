import "@typespec/http";

using Http;

/**
 * Model inheritance, in the shapes that decide whether a derived validator is usable.
 *
 * `baseModel` appeared **nowhere** in this emitter, so a derived model was emitted carrying only its
 * own properties - and, because it is a leaf, sealed against the ones it inherits. The failure is not
 * a missing field: it is a `400` naming a key the published contract requires.
 */
@service(#{ title: "inheritance" })
namespace Inheritance;

model Building {
  address: string;
  floors?: int32;
}

/** One level, and sealed - the case that rejected a conformant body. */
model House extends Building {
  garden: boolean;
}

/** Two levels, so the walk has to be a chain rather than one hop. `House` is therefore NOT a leaf. */
model Mansion extends House {
  ballrooms: int32;
}

/**
 * A LEAF, which is the only kind openapi3 seals - sealing a base would make a subtype's own
 * properties "unevaluated" against it. So this is the model that must both accept what it inherits
 * and still reject what nobody declared.
 */
model Cottage extends Building {
  thatched: boolean;
}

/** A derived model REDECLARING an inherited property must override it, not duplicate it. */
model Annex extends Building {
  address: string;
  detached: boolean;
}

/**
 * Inheriting an indexer, not just properties. `model X extends Record<string>` puts the catchall on
 * the base, and openapi3 publishes the base's `unevaluatedProperties` - which, measured with Ajv
 * 2020-12, makes the derived model's own seal inert. So the derived validator must carry the
 * catchall too.
 */
model Ledger extends Record<string> {
  reference: string;
}

@route("/house") op house(@body body: House): House;
@route("/cottage") op cottage(@body body: Cottage): Cottage;
@route("/mansion") op mansion(@body body: Mansion): Mansion;
@route("/annex") op annex(@body body: Annex): Annex;
@route("/ledger") op ledger(@body body: Ledger): Ledger;
