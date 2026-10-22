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

/**
 * **`as` is legal as an interface name and illegal as a type alias name**, and this emitter writes
 * both for every model. It is contextual, so the reasoning that kept `yield` and `string` out of the
 * reserved set kept `as` out too, and a model named `as` emitted `export type as = ...` --
 * `TS1005`, after which the parser gives up and the whole file is lost. The corpus declares it; this
 * package compiled nothing that did.
 */
model `as` {
  value: string;
}

/**
 * **`yield` was recorded in the reserved set's own docblock as measured-legal, and it is not.**
 * `TS1214: 'yield' is a reserved word in strict mode`, in both positions. A claim that a word was
 * measured is not the same as the measurement still holding.
 */
model `yield` {
  value: string;
}

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

@route("/as")
@post
op takesAs(@body body: `as`): Holder;

@route("/yield")
@post
op takesYield(@body body: `yield`): Holder;

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
