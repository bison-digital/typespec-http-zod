import "@typespec/http";

using Http;

/**
 * Models named after reserved words, and a discriminated union carrying the default envelope.
 *
 * Both emitted invalid TypeScript. `export interface await` is `TS2427`, and a discriminated union
 * with an envelope rendered as `export interface X { ... } | { ... }`, which is not a thing an
 * interface can be - so the whole file failed to parse and the parser gave up after the first one.
 *
 * The corpus declares the reserved-word case deliberately in `special-words`. It went unseen because
 * that scenario crashes `@typespec/openapi3`, so it is classified as an oracle failure and skipped as
 * undifferentiable - while the files are still written and are still invalid. A scenario excluded
 * from one oracle for a good reason was excluded from every oracle by accident.
 */
@service(#{ title: "special words" })
namespace SpecialWords;

model `await` {
  value: string;
}

model `break` {
  value: string;
}

model `for` {
  value: string;
}

model Cat {
  name: string;
}

model Dog {
  bark: string;
}

/** The DEFAULT envelope: what a spec gets from `@discriminated` and nothing else. */
@discriminated
union Pet {
  cat: Cat,
  dog: Dog,
}

model Holder {
  pet: Pet;
}

@route("/await")
@post
op takesAwait(@body body: `await`): Holder;

@route("/break")
@post
op takesBreak(@body body: `break`): Holder;

@route("/for")
@post
op takesFor(@body body: `for`): Holder;

@route("/pet")
@post
op takesPet(@body body: Holder): Holder;
