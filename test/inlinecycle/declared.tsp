import "@typespec/http";

using Http;

/** An ORDINARY recursion that closes on a declaration, which must not be refused. */
@service(#{ title: "Declared" })
namespace Declared;

model InnerModel {
  property: string;
  children?: InnerModel[];
  byName?: Record<InnerModel>;
}

/**
 * **The ARRAY is the only entry point, and that ordering is the whole case.** The array is walked
 * first, `InnerModel` is declared inside it, and the model's own `children` re-enters the same array
 * type. The cycle closes on `InnerModel`, which is a declaration, so it terminates and must not be
 * reported. A guard keyed on re-entry alone refuses this, and it broke `type/array` and
 * `type/dictionary` in the conformance corpus before the declaration test was added.
 *
 * Declaring the model through a body first would hide it: the model would already be in
 * `#declarations` by the time the array is reached, and the re-entry would never happen.
 */
@route("/inner")
@get
op list(): InnerModel[];
