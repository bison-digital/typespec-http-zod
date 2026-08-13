import "@typespec/http";

using Http;

/**
 * The spelling this emitter REFUSES, and why refusing is the answer.
 *
 * `@discriminated(#{envelope: "none"})` puts the discriminator inside the variant on the wire, and
 * `@typespec/openapi3` publishes the variant unchanged - so the document names a discriminator it
 * never requires, which OpenAPI 3.1 forbids ("the discriminator field MUST be a required field").
 *
 * **The emitter briefly injected the property itself instead.** The validator was right and the
 * document was wrong, and it was booked as a "declared divergence" with a warning and a committed
 * list - which is a custom track with a label on it. A validator may only enforce what the contract
 * states; deriving a rule from nowhere is the same mistake as the `@refine` predicate this effort
 * exists to delete. Fixing it is one line in the spec, and the diagnostic says which line.
 */
@service(#{ title: "undeclared" })
namespace Undeclared;

model Cat {
  name: string;
  meow: boolean;
}

model Dog {
  name: string;
  bark: boolean;
}

@discriminated(#{ envelope: "none" })
union Pet {
  cat: Cat,
  dog: Dog,
}

@route("/pet") op pet(@body body: Pet): Pet;
