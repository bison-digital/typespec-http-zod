# Guides

## Installing

The emitter runs at build time. The generated files import `ResponseArm` as a type, which erases at
compile time, so a dev dependency is enough if that is all you use.

`./runtime` also exports `armFor`, which is a function. An application that calls it and installed
the package as a dev dependency will typecheck, build, and run in development, then fail on deploy:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'typespec-http-zod'
    imported from dist/server.js
```

Install it as a regular dependency if you call `armFor`.

## Emitting the contract types

`schemas.gen.ts` is emitted always. The other three files need somewhere to go:

```yaml
emit:
  - typespec-http-zod
options:
  typespec-http-zod:
    emitter-output-dir: "{project-root}/src/generated"
    contracts-output-dir: "{project-root}/src/generated"
```

`requests.gen.ts` holds plain TypeScript with no imports, so the types can cross layers that must not
see a validation library. `WireInputs["op"]` is each operation's input as a caller supplies it, and what
its handler receives is assignable to it: a model body merged with the parameters, any other body under
its parameter's name, a binary `bytes` body as a `ByteStream | null`, and `Record<string, never>` for an
operation that takes nothing. A property with a default is optional here, because a caller may leave it
out, though the handler always receives it.
`keyof WireInputs` is every operation the service declares. `WireResults["op"]` is its result: one
member per declared response, each a `{ status, body, headers }` pairing a status with its own body,
which a backend can return and a server emitter's handler can hand straight on. `WireOutputs["op"]` is just the success bodies. `wire-contract.gen.ts` asserts the emitted
Zod accepts exactly those types, and needs `contracts-package` as well, naming the specifier the types
are imported from.

## Validating a request

Each operation gets a validator per request location, because a validator library checks one target
at a time and a caller needs to know which part of the request was wrong.

```ts
import { readWidgetPath, readWidgetQuery, createWidgetBody } from "./generated/schemas.gen.js";

const path = readWidgetPath.safeParse(request.params);
if (!path.success) return { status: 400, body: path.error.issues };
```

Path, query and header values arrive as strings. The emitted validator decodes the wire form before
the document's schema runs: `"1"` becomes `1` for an integer parameter, and `?tags=a,b,c` is split on
the delimiter the document's `style` implies. It decodes rather than coerces, so `?limit=` stays
empty and fails the schema rather than arriving as `0`. Hand the raw values straight in.

A `content-type` header is compared after its parameters are stripped, so
`multipart/form-data; boundary=...` matches the declared media type.

### Which schema validates a body

An operation's body validator is named `<operationId>Body`. Where the body is a declared model, no
second name is minted and the component's own schema is the validator: `op createWidget(@body body:
WidgetCreate)` is validated by `widgetCreateSchema`. An operation with no `...Body` const is one
whose body is a named component.

## Answering with the right body

An operation can declare `404`, `4XX` and `default` at once, and all three describe a 404. OpenAPI
settles it: an explicit code takes precedence over a range, and `default` is every status not
otherwise listed. `armFor` applies that rule.

```ts
import { armFor, type ResponseArm } from "typespec-http-zod/runtime";

function respond(arms: readonly ResponseArm[], status: number, body: unknown) {
	const arm = armFor(arms, status);
	if (arm === undefined) throw new Error(`no declared arm for ${status}`);
	return { status, body: arm.schema === undefined ? undefined : arm.schema.parse(body) };
}
```

For an operation declaring all four arms:

| answered | arm chosen | body validated against |
| -------- | ---------- | ---------------------- |
| `200`    | `200`      | the success model      |
| `404`    | `404`      | `NotFound`             |
| `429`    | `4XX`      | `Throttled`            |
| `500`    | `default`  | `Unexpected`           |

`schema: undefined` on an arm means the document says that response carries no body.

## Content types

`EmittedRoute` carries `requestContentTypes` and `responseContentTypes`, the media types the document
states for each direction. A server uses them to choose how to read a body and how to negotiate a
response. A `bytes` body served as `application/octet-stream` or an image type is raw binary, and the
document publishes only `contentMediaType` for it, so no validator is emitted.

## Versioning

A spec using `@typespec/versioning` is projected to the version it currently serves before it is
walked, so an operation removed in a later version is not emitted and a property made optional is
optional. `@typespec/versioning` is an optional peer dependency, resolved behind a guarded import.

## OpenAPI versions

The validators agree with the document `@typespec/openapi3` publishes, and OpenAPI 3.0 and 3.1 read
some schemas differently. The emitter reads which one from openapi3's own `openapi-versions` option,
whether or not openapi3 is emitted, and takes openapi3's default, `3.0.0`, where it is unset:

```yaml
options:
  "@typespec/openapi3":
    openapi-versions: ["3.1.0"]
```

- **A required read-only property is required "on the response only" at 3.0** (OAS 3.0.4,
  `readOnly`), so a request may leave a server-assigned `id` out. Where a model's request reading
  differs from its response one, the request's is declared beside it, named for the request:
  `WidgetCreate` beside `Widget`, with `id?:` in the contract type. At 3.1 `readOnly` is an annotation,
  `required` holds in a request too, and there is one `Widget`.
- **`nullable` takes effect only beside `type` at 3.0**, and every other keyword still applies to
  `null`. openapi3 publishes `Inner | null`, `Color | null`, a named scalar's `| null`,
  `"a" | "b" | null` and `string | int32 | null` refusing `null`, so each is refused as
  `unpublishable-null`; `string | null`, a list, a record, a model expression or `unknown` with
  `| null`, and a union holding one of those, are published with a `type` and validate as written.
- **A sealed model is sealed with `additionalProperties` at 3.0**, which cannot see a record its base
  declares, so `extends Record<string>` under `seal-object-schemas` is refused as
  `unpublishable-record`. Spread the record onto the model, `...Record<string>`, which is open at
  every version.
- **Publishing 3.0 and 3.1 at once** reads a request two ways, and a request holding a required
  read-only property is refused as `ambiguous-read-only`. Publish one, or send the request's own view,
  `Create<Widget>`.

## Upgrading

### To `0.34.0`

**Every file is written in the order the spec declares what it holds**, and nothing a validator, a
request type or a route says changes. Regenerate, then expect one diff of moved declarations:

- **Where nothing is named before it is declared**, every file is what 0.33.0 wrote, byte for byte.
- **What is named before it is declared moves to where it is declared**: a union, enum or model no
  operation reaches that a model declared ahead of it names, and an interface that something
  checked ahead of it names, such as an augment decorator in a second file naming one of its
  operations. Whole declarations move; none changes.
- **A cycle between two declarations no operation reaches** is entered from the other one, so the
  getter that defers it moves to the other edge. Both parse alike.
- `EmittedService.routes`, `.operations` and `.service.operations` are in the same order, so an
  emitter built on this one writes in it too.

### To `0.32.0`

**The validators follow the OpenAPI version openapi3 publishes, and 3.0 is its default.** 0.31.0 read
every document as 3.1 does. Regenerate, then check:

- **A project publishing 3.0 - any that does not set `openapi-versions` - accepts a create or update
  body leaving out a required read-only property again**, as 0.30.0 did and as the 3.0 document says.
  The request's reading is declared beside the response's, `WidgetCreate` beside `Widget`; a handler's
  input types `id` as optional.
- **Three refusals can stop a 3.0 compile**, each naming the fix: `unpublishable-null` for a `null`
  the 3.0 document cannot say, `unpublishable-record` for a sealed model extending a record, and,
  where 3.0 and 3.1 are published together, `ambiguous-read-only`. The quickest fix for the first two
  is one line, `openapi-versions: ["3.1.0"]` under `@typespec/openapi3` in `tspconfig.yaml`.
- **A project publishing 3.1** compiles and validates as it did on 0.31.0.

### To `0.31.0`

**Every change makes a validator answer as the published document already does**, so a request one
of them accepted may now be refused, and the other way round. Regenerate, then check:

- **Seven errors can now stop the compile**, each naming the declaration and what to write instead:
  `unsatisfiable-encoding` for an `@encode` no value satisfies, `never-body` for a body declared
  `never` (declare `void`), `invalid-subtype-discriminator` for a subtype no dispatch can hold,
  `sealed-base-extended` for a template instance adding a required property to a base openapi3
  seals, `unrepresentable-override` for a redeclared property whose merge with the declaration
  above it refers back to itself, `ambiguous-form-reading` for a `@oneOf` sent as a URL-encoded form
  whose members read one key's text two ways (give the key one reading, or remove `@oneOf`), and
  `split-visibility` for a model openapi3 first reaches from a
  request and publishes with a read-only property required and not declared, or left out. For the
  last, declare the request's own view as a model of its own - `model OuterCreate is
Create<Ns.Outer>;`, or `CreateOrUpdate<...>` for a `PUT` - and send it as the `@body`, which
  openapi3 publishes apart, through every model it reaches. Declared as a model, the view does not
  inherit `Outer`'s `@friendlyName`, and spelled from the global namespace, it resolves wherever it
  is written; the message names it so. `header-case-collision` refuses two headers whose names differ only in case, and
  `unsupported-type` now refuses an instance of a list template, `model Page<T> is T[]`, which
  openapi3 publishes as an object: declare a named list per element type instead. It also refuses a
  union that reaches itself through union members alone - `union string { int32, string }` in a
  namespace names itself - where the compile crashed: qualify the member, `TypeSpec.string`. `undeclared-discriminator` also refuses a `@discriminated` variant
  whose discriminator is not one fixed value, and `duplicate-declaration` one model used both inside
  an explicit `@body` and outside one. `encode-cycle` is gone: those declarations are
  `unsatisfiable-encoding` now.
- **`unenforceable-encoded-bound` is now `unenforceable-encoded-constraint`**, and covers every
  constraint an `@encode` moves onto a type it does not apply to; a default that is no value the
  position accepts is the warning `invalid-default`. Rename a `#suppress` that names the old code.
- **More declarations.** Every model, enum and union the service declares has a validator and a
  contract type now, reached by an operation or not, as the document publishes a component for each.
  A construct this emitter refuses - an unsatisfiable `@encode`, say - in a type nothing uses was
  never walked and now stops the compile: fix it or remove the type.
- **Renamed declarations.** A component carries a visibility suffix only where its type is used at
  more than one visibility, as the document names it: a model only ever sent in a create body is
  `Holder` and `holderSchema`, no longer `HolderCreate` and `holderCreateSchema`. A named list model
  sent and returned is `TagsCreate` beside `Tags`, and one a model holds is named for the visibility
  openapi3 reads that model at, so `Mid`'s `tags` is `TagsCreate` where `Mid` is first sent in a
  create body, and a union instance there `MaybeCreate`, with no `Maybe` where the document has
  none. A model, enum or union carrying `@friendlyName` is declared under that name, and a union
  template instance with an argument that has no name - `Maybe<{ x: string }>` - is written out where
  it is used rather than declared. A model named `WireReader`, `WireReaders`, `ArrayBuffer` or
  `Uint8Array` takes a trailing `_`, as `SPEC_VOCABULARIES` does, since the generated files name the
  helper or the library type of that name, and so does one named after a TypeScript predefined type
  or a strict-mode word - `string_`, `public_` - which no file could declare; one named `Record`,
  which was validated inline, is declared as `Record`. Rename the imports `tsc` reports as missing; each new name is the
  component's name in the document.
- **A shared route's parameter may be optional now**, where openapi3 publishes it so: one that
  another operation on the same `@sharedRoute` path and verb does not declare, or declares unalike.
  `sa(@query q: string)` beside `sb(@query other?: string)` gives `sa`'s handler `q?: string`, so
  handle its absence.
- **A parameter declared `never` is gone from the input**, as the document leaves it out: it was
  validated as `z.never()`, refusing every request that sent it, and typed `never`. Remove the code
  that reads it.
- **`@useRef` is refused.** A type published only as a reference to another document has no schema
  the document states, and `unsupported-type` now says so: remove `@useRef`, or validate that value
  yourself.
- **A list in a header, cookie, path or non-exploded query object is no longer read from one
  value.** `h: l,1` was `{ l: [1] }`; the document refuses it, as one piece of text spells no list,
  and the validator does too. A form-exploded query and a URL-encoded form, where a key repeats,
  still read `?l=1` as `[1]`.
- **A read-only property in a create or update body.** A model whose only request-side difference is
  a read-only property is now validated, in the request, as the schema openapi3 publishes for it:
  the canonical one, with the property still `required` and marked `readOnly`. Under OAS 3.1.1's
  reading of `readOnly` (section 4.8.24.3.2) a caller sends it and the server ignores the value, so
  check every caller that left it out, and have the handler ignore what arrives. The `XCreate`,
  `XUpdate` and `XCreateOrUpdate` declarations and contract types that differed only by read-only
  properties are gone: use `X`. A create-only or update-only property still makes its projection,
  named as the document names it, and a response is validated as the read view. A body whose
  read-only property shares a parameter's name is now named like any other such body - `@path id`
  beside a body requiring `id` hands the handler both, `input.id` and `input.body.id` - where it was
  merged on the grounds that a read-only property is not sent.
- **A metadata property inside an explicit `@body` is a body property.** `@typespec/http` ignores
  `@header` there, and the document publishes the property with its constraints, so the validator
  now requires it.
- **Narrowing on a discriminated base.** Every base's type is the subtypes and the base itself, a
  closed one included:

  ```ts
  type Snake = Cobra | { kind: SnakeKind; length: number };
  ```

  so `if (snake.kind === "cobra")` no longer narrows to `Cobra`. A value naming `cobra` that is not a
  valid `Cobra` is a valid `Snake`, as the document says. Narrow on a property the subtype declares.
  A visibility template of a base, `Create<Pet>`, is the base's own object and no longer dispatches to
  `Pet`'s subtypes, whose canonical schemas its own properties do not hold to.

- **A redeclared property keeps its base's rules, and a discriminator is required.** A subtype's
  `name: string` under a base's `@maxLength(3)` is held to three characters, and a body omitting the
  discriminator is refused even where the spec wrote `kind?:`. A redeclaration that is neither the
  base's type nor narrower is merged with it key by key, as the document's `allOf` holds it, where
  it was refused. A redeclaration as `never`, or one invisible where the model is used, no longer
  removes a key a base requires: the document still requires it, through the base.
- **A `@oneOf` refuses the `null` two of its members match.** `@oneOf unknown | null`, and a
  `@oneOf` with two `null` variants, accept no `null`, as the document's `oneOf` accepts none.
- **An `@encode`d value is the declared type and the encoded type at once.** An encoded `Color`
  refuses `"green"`, a named scalar keeps its `@pattern`, `"a" | "b" | null` keeps its `null`, and a
  union keeps only its members of the encoded type.

### To `0.30.0`

**One change makes a validator accept values it refused, and the document already accepted them.**
A `@discriminator` base whose discriminator admits a value no subtype claims - a `string`, a union
with `string` in it, an enum with a member nothing maps - now validates such a value as the base. A
value naming a subtype is that subtype, as before. Regenerate, then check two things:

- **Narrowing on the discriminator.** The base's type is the subtypes and the base itself:

  ```ts
  type Bird = SeaGull | Sparrow | Goose | Eagle | { kind: string; wingspan: number };
  ```

  so `if (bird.kind === "eagle")` no longer narrows to `Eagle`, because the base arm's `kind` is any
  string to TypeScript. Narrow with a type guard on what the subtype declares, or switch on `kind`
  and handle the base in the `default`.

- **A handler returning an unknown kind**, which used to answer 500 through its response contract,
  is now served.

**A body declared `void` or `never` lists no media type**, on a response and on a request. A consumer
reading `EmittedResponse.contentTypes` gets `[]` for it, and `WireInputs` states no input for a
request declared that way, where it said `{ body: never }`.

**Two new diagnostics.** `shared-input-key` warns about two inputs a handler would be handed under
one key; give one of them a different name. `encode-cycle` refuses an `@encode` chain that returns to
where it started. Neither can appear for a spec that compiled correctly before.

**A wrapping emitter building an `EmittedRoute` by hand** adds `sharedInputKeys: []`. One reading the
routes the library produces declines to serve an operation whose `sharedInputKeys` is not empty, as
`typespec-hono` and `typespec-http-mcp` do.

### To `0.29.0`

**Three changes make a validator refuse values it accepted, and in each the document already refused
them.** Regenerate, then check whether a caller of yours relies on one:

- **A date-time header with no `@encode` is an HTTP-date**, `Fri, 26 Aug 2022 14:38:00 GMT`, and an
  RFC 3339 value in it is refused. A handler setting one sets the HTTP-date form. To keep RFC 3339 on
  the wire, say so in the spec, and the document will say it too:

  ```tsp
  @header @encode(DateTimeKnownEncoding.rfc3339) since: utcDateTime;
  ```

- **A scalar extending a constrained scalar enforces the base's constraints.** A value breaking a
  `@pattern`, a bound or a length on the base is refused through the derived one.
- **`@encode(DateTimeKnownEncoding.rfc3339)` on a date-time checks the date-time**, where it accepted
  any string.

**Everything else is additive or a spelling.** The emitted validators carry `.describe(...)`, so a
snapshot of a generated file changes, and spec text outside ASCII is written as `\uXXXX` escapes.
Two new warnings may appear, `optional-prototype-name` and `unenforceable-property-name`; each names
a property whose validator cannot do what the document says, and the [reference](reference.md) says
what to do about it.

**A wrapping emitter that validates a path parameter's VALUE**, rather than the segment text a router
extracts, reads `EmittedRoute.decodedPathParameters` and validates those against
`pathSchema.shape[name].out`.

### To `0.28.0`

**Most changes here are to `requests.gen.ts`, the framework-free contract types.** Five reach a server
emitter's handlers whether or not contracts are emitted, because they change what `EmittedRoute`
and `resultMembersOf` publish:

- a body declared only under media types nothing can parse, such as a model as `application/xml` or a
  `string | int32` as `text/plain`, is handed over under its parameter's name as it arrived, and is
  not validated: as the text under a textual media type, and as the unread stream under any other,
  such as `application/octet-stream`;
- a model answered under a media type that is neither JSON nor text is bytes, not a string;
- a model body that sends a key a parameter also has is named rather than merged;
- a media type declared with a parameter or in capitals, such as `application/json; charset=utf-8`, is
  JSON, so its body is placed and validated as JSON;
- an `@encode`d response header's type is its encoded type: `number` for
  `@encode(DurationKnownEncoding.seconds, int32)`, where it was `string`.

#### An optional property is `?: T`

The contract types now state the validator's input exactly. A plain optional property is `?: T`, and
only a property with a default keeps `?: T | undefined`, because `.default(v)` accepts an explicit
`undefined` and fills `v`:

```ts
// before
interface Thing {
	id: string;
	note?: string | undefined;
	count?: number | undefined;
}
// now (note is plain, count has a default)
interface Thing {
	id: string;
	note?: string;
	count?: number | undefined;
}
```

Under `exactOptionalPropertyTypes`, code that assigns `{ note: maybe }` where `maybe` may be
`undefined` now fails to compile. It was a value the validator refused: a handler returning it answered
`500`. Write the conditional spread, which assigns to the exact type:

```ts
const thing: Thing = { id, ...(maybe === undefined ? {} : { note: maybe }) };
```

The spread covers one property. A value whose own type declares `?: T | undefined` further down, such
as a nested `meta.note`, fails at that depth, and `TS2375` names the path. Declare that
type's optional properties `?: T` as well, and the value assigns whole. Where the type cannot change,
the conversion has to leave the key out at every depth, because the validator refuses a present
`undefined`.

A widening helper has to be deleted wherever it stood in for the old `?: T | undefined`:

- one that widened a side so the two surfaces compared equal, such as a mapped type adding
  `| undefined` to `openapi-typescript`'s output, now makes the comparison fail;
- a value of a widened type no longer assigns to the contract (`TS2375`).

A widening on a type that only receives a contract value, such as a parameter, still compiles. It
admits a value the validator refuses, so delete it as well.

#### `WireInputs["op"]` is the handler's input

A body the merge cannot express is named, exactly as a server emitter names it. That is a union,
array, indexed model, scalar, enum, optional or optional multipart body:

```ts
// op createShape(@path id: string, @body body: Shape): Thing;
// before
type CreateShapeInput = Shape & { id: string };
// now
WireInputs["createShape"]; // { id: string; body: Shape }
```

A model body is still merged. **Delete any code that flattened a handler's input to reach a backend
typed by the old contract**: the two now agree, and the flattening is the bug. Where a backend's own
port takes the body and its parameters as one object, merge them where it is called,
`{ ...input.body, id: input.id }`, and type a raw body read for itself as `WireInputs["op"]["body"]`,
not as the whole input.

**A model body that sends a key a parameter also has is named too.** Merged, one value replaced the
other and the handler saw only the body's: `POST /shelves/1/books` with `{ "shelfId": 2 }` in the
body handed the handler `shelfId: 2`, so the book landed on the shelf the BODY named while any check
made on the path saw shelf 1. The handler now receives both:

```ts
// op add(@path shelfId: int64, @body body: Book): Book;   // Book has shelfId
// before: { shelfId: number; title: string; ... }         // the path's shelfId was lost
// now:    { shelfId: number; body: Book }                 // input.shelfId is the path's
```

A read-only property is not in the body sent, so `@path id` beside a model whose `id` is
`@visibility(Lifecycle.Read)` collides with nothing and still merges. The body is under its `@body`
parameter's name, so for `@body body: Entry` read `input.body.x` where a handler read `input.x`, and
decide which of the two values the operation means. **Typecheck before you ship it:** a build that
bundles without typechecking, as `wrangler deploy` does, compiles a handler still reading `input.x`,
which is then `undefined`.

Every operation is keyed, so `keyof WireInputs` is every operation the service declares. One that takes
no input is `Record<string, never>`. A hand-kept list of the operations it used to leave out can be
deleted.

A type that told operations with an input from those without by asking `K extends keyof WireInputs`
no longer separates them: every operation is a key now. An operation with no input takes `{}`, which
is what the generated route passes it, so pass `{}` where such a type had you pass `undefined`.

A binary `bytes` body is a `ByteStream`, the stream the server hands over unread. It was an
`ArrayBuffer`. A platform `ReadableStream<Uint8Array>` is assignable to it, so a handler's input can be
forwarded to a backend as it is.

**The per-operation aliases are gone.** `CreateShapeInput` and its kind collided with the request
models specs give the same names. Use `WireInputs["createShape"]`.

#### `WireOutputs` and `WireResults`

`WireOutputs["op"]` is every success body the operation declares: a union where it has several,
`undefined` for one with no body, and `never` where nothing succeeds. It was the lowest status's body
alone.

`WireResults["op"]` is new: the operation's result, one member per declared response, each a
`{ status, body, headers }` pairing a status with its own body. A backend typed by it can say whether
it answered `200` or `201`, and a handler can return what it returns:

```ts
interface Backend {
	createPet(input: WireInputs["createPet"]): Promise<WireResults["createPet"]>;
}
```

A hand-written result type such as `{ status: number; body: T }` can be deleted.

A model served under a media type that is not JSON, such as `application/xml`, is `string` in both:
the text the producer serialises, which is what a server hands over and sends. It was
`Produced<Model>`. The model is still declared, so an import of it keeps working.

A binary response body is `Uint8Array<ArrayBuffer>` among its alternatives, which needs TypeScript 5.7
or later.

#### A model named after an emitted helper gets a trailing `_`

`ByteStream`, `Produced`, `ResponseArm`, `Simplify`, `WireInputs`, `WireOutputs` and `WireResults` are
declared by the emitted files themselves. A model with one of those names is now declared with a
trailing `_`, as a reserved word already was. Before, it failed to compile, or for the lookups merged
silently into them.

#### An `Http.File` body reaches the handler

A file upload is a raw body under its parameter's name, with the media type it was sent as under
`"Content-Type"`, and a download is a binary arm. Both were dropped: the handler was handed `{}`, and a
download was served empty.

#### A spec with more than one `@service` gets contracts per service

Where two or more services write to the top-level `contracts-output-dir`, each writes to
`<dir>/<ServiceName>`. Point each service's imports at its own directory. A package specifier given
as `contracts-package` has to be set per service, under `services`. A service that is the only one
writing there, the others naming their own `contracts-output-dir` under `services`, writes where it
did, and nothing changes for it.

#### TypeSpec 1.17

The optional `@typespec/streams` and `@typespec/versioning` peers admit `^0.87.0`.

### To `0.27.0`

**Nothing here reaches you until you ask for it.** A `^0.x` range pins the minor, so `^0.26.0` never
resolves `0.27.0`. You move when you choose to.

**Enable the linter while you are here.** The ReDoS check is an opt-in rule now, because the spec is
valid and the emitted regex is the published one, and TypeSpec reserves automatic diagnostics for a
program its library cannot serve:

```yaml
# tspconfig.yaml
linter:
  extends:
    - "typespec-http-zod/recommended"
```

#### A declared integer width is enforced

All ten integer scalars used to emit `z.number().int()`, which means "an integer in the safe range"
and nothing more. Measured at the wire:

| the caller sends       | before | now |
| ---------------------- | ------ | --- |
| `uint8` = `10`         | 200    | 200 |
| `uint8` = `255`        | 200    | 200 |
| `uint8` = `-5`         | 200    | 400 |
| `uint8` = `100000`     | 200    | 400 |
| `int32` = `3000000000` | 200    | 400 |

Nothing in your spec changes. What to check is whether any caller relies on sending a value outside a
width you declared; if a field genuinely holds a wider range, declare the wider type.

**A client generated from your document will not agree with your server on this**, and that is worth
knowing before you upgrade. `@typespec/openapi3` publishes a width as `format: uint8` with no bounds,
and JSON Schema 2020-12 makes `format` an annotation, so Ajv and most generators accept `-5` happily.
The server refuses it. Before this release both accepted it and both were wrong; now the server is
right and the document cannot say so. This cannot be fixed here: the document is upstream's.

#### A `@pattern` is compiled with the Unicode flag

A JSON Schema `pattern` is an ECMA-262 expression and a reader compiles it with `u`. This package
emitted a bare `/.../`, so `\p{L}` was an identity escape for the letter `p` rather than a Unicode
property, and the server ran a different expression from the one your document publishes.

The flag is carried wherever the pattern compiles under it. Two things follow:

- **`\p{...}` now means what it says.** If you wrote one, it was matching the literal characters
  before and is matching the property now.
- **`.` and quantifiers count code points, not UTF-16 units.** `^.{3}$` accepts `a<emoji>b` now and
  refused it before. This is the document's own reading, so it is a fix, but it is a change.

The change bites where a pattern counts characters or names a property, not across the board. A
pattern the flag cannot compile keeps the bare form and raises `non-unicode-pattern`; the remedy is to remove the backslash that was never needed, such
as a `\-` outside a character class.

**Grep for `@pattern(` will not find them all.** A pattern held in a `const` and referenced by name
is the easy one to miss.

#### A `@pattern` containing a forward slash now emits a module that parses

`^\/api\/v[0-9]+$` used to emit a regex literal that ended early, so the generated module was a
syntax error, from a compile that reported success. If you avoided slashes in patterns because of it,
you no longer need to.

#### A numeric bound on a value `@encode(string)` carries as text is dropped

`@encode(string) @minValue(10) capacity: int32` emitted `z.string().min(10)`, a check on how many
characters the value has: it refused `"42"`, which your spec permits. The exclusive form emitted a
call that does not exist on a string schema, so the module threw on import.

The bound is now dropped and `unenforceable-encoded-bound` names it. A value the old length check
refused is now accepted, and a value below the bound is accepted too: the document publishes
`minimum` on a `type: string` schema, which JSON Schema says does not apply, so enforcing it would
refuse what your published contract accepts. Declare the bound as a `@pattern`, which the document
publishes and every caller can read.

#### Two types with one name are refused

`duplicate-declaration` is an error, and it is raised from the schema walk now as well as the
contract walk. Before, two namespaces each declaring `Thing` emitted `export const thingSchema`
twice: `tsc` answered `TS2451` and `tsp compile` reported success.

It fires **per emitted file**. A program whose services are partitioned into their own output
directories is unaffected even where two of them share a model name. If you do compile colliding
names into one output, rename one or give it `@friendlyName`.

#### A reference cycle with no declaration on it is refused

`model Box<T> { next?: Box<T> }` used as `Box<string>` used to exhaust the stack and report "Emitter
crashed! This is a bug." It now raises `inline-cycle`, matching what `@typespec/openapi3` raises on
the same spec. The remedy is `@friendlyName`, which now really does give the instantiation a name.

#### `@friendlyName` on an instantiation changes emitted names

It used to do nothing here while `@typespec/openapi3` published a component for it. A named
instantiation is now a declaration and emits `stringBoxSchema` beside the document's `stringBox`. If
you import generated schema names directly, check them.

#### `compile-schemas` no longer compiles any member of a reference cycle

Only the deferred declaration was left uncompiled before, which was enough on zod 4.5 and not on
4.6, where the failure moved to the schema that references it and threw at first parse. No action;
the emitted output changes for recursive models under that option.

## Building an emitter on this API

`emitHttpZod` returns one `EmittedService` per `@service`. `EmittedService.schemaNames` maps each
operation id to the identifiers its validators were declared under, and
`EmittedService.typeSchemaNames` maps each declared type to its own validator's, so a wrapping
emitter imports names rather than agreeing about them.

```ts
import { emitHttpZod } from "typespec-http-zod";

export async function $onEmit(context: EmitContext) {
	const services = await emitHttpZod(context);

	for (const service of services) {
		for (const route of service.routes) {
			const names = service.schemaNames.get(route.operationId);
			// names.path, names.query, names.header, names.body, names.arms, names.responses
			// names.selectedAccept: the `accept` literal a negotiated operation's handler receives
			// route.responses: each declared status with its body, media types and headers
		}
	}
}
```

A declared type's validator is reached by the type: a body resolved to the model it is, then a
subtype of it, told apart by its own validator because the base's parsed output does not say which
arm of its dispatch matched. See
[A declared type's validator, by the type](reference.md#a-declared-types-validator-by-the-type).

```ts
import { createMetadataInfo, Visibility } from "@typespec/http";

const metadata = createMetadataInfo(context.program, { canonicalVisibility: Visibility.Read });
for (const operation of service.operations.values()) {
	for (const response of operation.responses) {
		for (const content of response.responses) {
			if (content.body === undefined) continue;
			const model = metadata.getEffectivePayloadType(content.body.type, Visibility.Read);
			if (model.kind !== "Model") continue;
			for (const subtype of model.derivedModels) {
				// `goldenSchema`, imported from `schemas.gen.ts`; `undefined` where it is refused.
				const identifier = service.typeSchemaNames.get(subtype);
			}
		}
	}
}
```

The files this package writes import no runtime: `schemas.gen.ts` declares the arm shape it annotates
its response lists with. A wrapping emitter that writes beside them - a server, a tool surface - owns
whatever its own files import, so two emitters pointed at one output directory write a byte-identical
`schemas.gen.ts` whenever their options match.

`EmitterOptionsSchema` is published so a wrapping emitter can derive its option contract rather than
restate it.
