import "@typespec/http";

using Http;

/**
 * Declarations refused whole, so their types have no entry: two models of one name, refused as
 * `duplicate-declaration`, and a model split by visibility, refused with its description kept. `Kept`
 * and `Outer`, which hold them, are declarations of their own and have entries.
 */
@service(#{ title: "Refused names" })
namespace RefusedNames;

namespace Alpha {
  model Thing {
    a: string;
  }
}

namespace Beta {
  model Thing {
    b: int32;
  }
}

model Kept {
  alpha?: Alpha.Thing;
  beta?: Beta.Thing;
  note: string;
}

@route("/kept") @get op kept(): Kept;

/** Reached only from a create body, through a model the request reshapes: split, and refused. */
model Inner {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}

model Outer {
  @visibility(Lifecycle.Create) secret: string;
  inner: Inner;
}

@route("/outer") @post op createOuter(@body body: Outer): void;
