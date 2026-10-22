import "@typespec/http";
import "@typespec/openapi3";

using Http;

/**
 * Types no operation reaches, which openapi3 publishes as components at `All` - and the two it
 * leaves out: a model spread as parameters, published as parameters, and a template declaration.
 */
@service(#{ title: "Unreached" })
namespace Unreached;

/** Reached by an operation at `Read`, and from an unreached model at `All`. */
model Reached {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
@route("/r") @get op read(): Reached;

/** Spread as parameters: openapi3 publishes these as parameters, not as a schema. */
model Params {
  @query q?: string;
  @header("x-t") t?: string;
}
@route("/p") @get op list(...Params): void;

model Plain {
  name: string;
  count?: int32;
}
model Holder {
  reached: Reached;
  plain: Plain;
  tags: string[];
}
/** Reshaped at `All`: its create-only property is part of it there. */
model Staged {
  @visibility(Lifecycle.Create) secret: string;
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
enum Colour {
  red,
  green,
}
model Circle {
  radius: float64;
}
union Shape {
  circle: Circle,
  text: string,
}
@discriminator("kind")
model Animal {
  kind: string;
}
model Dog extends Animal {
  kind: "dog";
  bark: boolean;
}
model Tags is string[];

namespace Sub {
  model SubThing {
    x: string;
  }
}

/** A template declaration is no type, and its instances are inlined. */
model Box<T> {
  v: T;
}
