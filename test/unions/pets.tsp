import "@typespec/http";

using Http;

/**
 * `@discriminated` unions, in the four wire shapes the decorator can produce.
 *
 * A discriminated union is a choice between **wrappings** of its variants, not between the variants
 * themselves. Ignoring the wrapping produced `z.discriminatedUnion("kind", [catSchema, dogSchema])`
 * over models that carry no `kind` at all - a union that matches nothing, on every polymorphic
 * endpoint, invisible because the differential read a discriminated component as an object.
 */
@service(#{ title: "unions" })
namespace Unions;

model Cat {
  name: string;
  meow: boolean;
}

model Dog {
  name: string;
  bark: boolean;
}

/** The default: the variant is wrapped, under `kind` and `value`. */
@discriminated
union PetWithEnvelope {
  cat: Cat,
  dog: Dog,
}

/** Both names overridden, so neither is hard-coded. */
@discriminated(#{ discriminatorPropertyName: "petType", envelopePropertyName: "petData" })
union PetWithCustomNames {
  cat: Cat,
  dog: Dog,
}

/**
 * Variants that declare the discriminator THEMSELVES - the only spelling of `envelope: "none"` this
 * emitter accepts.
 *
 * For this shape openapi3's bare `oneOf` validates the wire exactly, so nothing should be injected -
 * and injecting anyway is behaviourally identical, which is precisely why it needs a test rather
 * than an eyeball.
 */
@discriminated(#{ envelope: "none" })
union Release {
  part: PartRelease,
  full: FullRelease,
}

model PartRelease {
  kind: "part";
  amount: int32;
}

model FullRelease {
  kind: "full";
}

@route("/release") op release(@body body: Release): Release;

@route("/envelope") op envelope(@body body: PetWithEnvelope): PetWithEnvelope;
@route("/custom") op custom(@body body: PetWithCustomNames): PetWithCustomNames;
