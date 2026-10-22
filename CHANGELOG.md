# Changelog

All notable changes to `typespec-http-zod` are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**At `0.x` the public API is not frozen.** A minor bump may change the emitted output or the
published types; a patch will not. The **emitted output is part of the API** - a change to a
validator's shape, to a declared identifier, or to the `EmittedRoute` a wrapping emitter reads is a
change a consumer feels, and is treated as such here rather than as an implementation detail.

## [0.34.0] - 2026-10-21

A minor, by this file's rule: the emitted files change for an unchanged spec, in order only. What a
validator, a request type or a route says is as 0.33.0 writes it.

Upgrading: [what to check before you take this](docs/guides.md#to-0340).

### Changed

- **Every file is written in the order the spec declares what it holds**, and `EmittedService.routes`,
  `EmittedService.operations` and `EmittedService.service.operations` are in that order: source file,
  as the program loaded them, then position; operations grouped as `@typespec/http`'s
  `listOperationsIn` groups them. `@typespec/http` lists them in the order the compiler finished
  checking their interfaces, which a type named early moves, so a second file whose only statement
  was an augment decorator naming an operation (a GraphQL surface's `@link`) reordered every route,
  validator and request of the service. See
  [The order things are written in](docs/reference.md#the-order-things-are-written-in).
- **Output moves once on upgrade where a type is declared after its first use.** The compiler files
  a type when it is first named, so a union, enum or model no operation reaches, declared after a
  model that names it, was written where it was named and is now written where it is declared. Of the
  specs this package's suite compiles, 42 moved, two of them `@typespec/http-specs` corpus specs
  (`streaming/sse`, `type/model/inheritance/not-discriminated`), each by whole declarations, but one:
  a cycle between two declarations no operation reaches is now entered from the other one, so the
  getter that defers it sits on the other edge, and both parse alike.

### Added

- `typespec-http-zod/package.json` is exported, for a tool that finds the installed version or root
  by name.

## [0.33.0] - 2026-10-20

The emitted files are as 0.32.0 writes them. Code that builds an `EmittedService` of its own, such
as a test double, adds the new field: `typeSchemaNames: new Map()` where it declares no types.

### Added

- **`EmittedService.typeSchemaNames`: each declared type's validator identifier, by the type.** A
  model, union or enum the document publishes under its own name maps to the identifier
  `schemas.gen.ts` exports its validator under - `Golden` to `goldenSchema`, `@friendlyName("Canine")`
  to `canineSchema`, `` `default` `` to `default_Schema` - so an emitter built on this one imports a
  declared type's validator by name, as `schemaNames` already lets it import an operation's. It is
  keyed by the types the service was emitted from, the ones `EmittedService.operations` holds, so a
  versioned service's keys are its types projected to the latest version. Each value is the
  declaration a response reads, never a view (`widgetCreateSchema`) or a 3.0 request's reading. Every
  subtype of a discriminated base is in it, nested bases included and whether or not an operation
  names it: a base's parsed output does not say which arm of its dispatch matched, and the subtype's
  validator is how a value is told apart. A declaration refused whole has no entry. See
  [A declared type's validator, by the type](docs/reference.md#a-declared-types-validator-by-the-type).
  Graded against the module in `test/typeschemanames/`, and across the corpus against the component
  openapi3 publishes for each type in `test/conformance/typenames.test.ts`.

## [0.32.0] - 2026-10-19

Upgrading: [what to check before you take this](docs/guides.md#to-0320).

Corrects 0.31.0, which read every document as OpenAPI 3.1 reads it while `@typespec/openapi3`
publishes 3.0 by default. The two answer some schemas differently, and nothing graded the 3.0 one:
every arm read a 3.1 or 3.2 document, and no probe sent `null`. Both are graded now - the corpus is
compiled publishing 3.0 alone and graded against the document as OAS 3.0.4 reads it, as a response
and as a request (`test/conformance/openapi30.test.ts`), and every property and value is probed
with `null` at every version.

### Changed, breaking

- **The validators follow the OpenAPI version openapi3 publishes**, read from its own
  `openapi-versions` option whether or not it is emitted, and `3.0.0`, openapi3's default, where it
  is unset. See [OpenAPI versions](docs/guides.md#openapi-versions).
- **At 3.0, a request may leave out a required read-only property**, as OAS 3.0.4 says such a
  `required` "will take effect on the response only". 0.31.0 required it, so a create body without a
  server-assigned `id` - which the document accepts, and which 0.30.0 accepted - was refused with 400. A schema a request reads apart from its response is declared again for the request, named for
  it: `WidgetCreate` beside `Widget`, with `id?:` in its contract type, nested ones included
  (`test/openapi30/`).
- **`unpublishable-null`, an error, refuses a `null` the 3.0 document cannot say.** OAS 3.0.4's
  `nullable` "only takes effect if `type` is explicitly defined within the same Schema Object", and
  every other keyword still applies to `null`: openapi3 publishes `Inner | null`, `Color | null`, a
  named scalar's `| null`, `"a" | "b" | null` and `string | int32 | null` refusing it, measured with
  Ajv, and a bare `null` as any value. The validators accepted `null` for each. `string | null` and
  its kin, published beside a `type`, validate as before.
- **`unpublishable-record`, an error, refuses a sealed model extending a record at 3.0.** openapi3
  seals it with `additionalProperties: { not: {} }`, which does not see the record in `allOf`, so
  the document refused every extra key the record admits and the validator accepted. The record
  spread onto the model, `...Record<string>`, is open at every version.
- **`ambiguous-read-only`, an error, refuses a request holding a required read-only property where
  openapi3 publishes 3.0 and a later version**, whose requests read it apart.

## [0.31.0] - 2026-10-19

Upgrading: [what to check before you take this](docs/guides.md#to-0310).

Corrects 0.30.0, which stated three things the document does not and loosened two checks to let one
of them pass, and fixes every other contradiction with the document found since - older ones
included. Each is fixed or refused with an error, but three the document
itself cannot state, listed as limits under Documented.

### Changed, breaking

- **A `@discriminator` base validates as the document's base, whatever its discriminator names.**
  OAS 3.1.1 section 4.8.25 is normative that the discriminator "MUST NOT change the validation
  outcome of the schema", and that in the `allOf` form openapi3 publishes, validating the parent
  does not use the child schemas at all; Ajv treats it as a no-op. 0.30.0 accepted a kind no subtype
  names, as the base, but held a kind a subtype names to that subtype's own fields - stricter than
  the document. The base is now `z.union([dispatch, ...nested bases, base])` with nothing guarding
  the base: the verdict is the base's, and a value that is a valid instance of the subtype its
  discriminator names comes back as that subtype, with its own properties, as an SDK deserializing
  the same body would. A closed discriminator still refuses a value outside it, through the base's
  own `kind`. **The base's TypeScript type is the subtypes and the base itself for every base**, a
  closed one included: `Snake` is `Cobra | { kind: SnakeKind; length: number }`, where it was
  `Cobra`, so narrowing on `kind` alone no longer reaches the subtype. The behaviour suite now
  tolerates no disagreement with the document at all.
- **A model validates as the document publishes it: `allOf` its base, keyed on the wire name.** A
  property a subtype redeclares is held to every declaration of it above. Where the redeclaration
  narrows the base's - a derived scalar, a model extending the base's, a list or record of those, a
  member of a union, a literal the base admits - the base's constraints, and its declared scalar's,
  apply to it for its own JSON type, so `Dog`'s `name: string` under `Pet`'s `@maxLength(3)` refuses
  `"rexie"`, as the document does; flattened to the subtype's declaration it was accepted, and so
  was the base through its dispatch. Where no value is both - an encoding added to an inherited
  property, a property renamed onto another inherited one's wire name, a literal the base refuses -
  it validates nothing, as the document does. **Where neither narrows the other, the declarations
  are merged into the one schema the document holds the value to**: two models key by key - a key
  one sealed side does not declare refused, a key either requires required, a typed indexer holding
  every key it does not name - two lists element by element with every declaration's `@minItems`,
  a union member by member with any member another declaration refuses dropped, a literal checked
  against every declaration, and two scalars of one JSON type neither narrows both checked.
  `Page<Widget>` over `Page<Item>`, `{ tag: "a" }` over `{ tag: string }`, `Open` over
  `Record<unknown>` and `Meta & { extra?: string }` over `Meta` each validate as the document does,
  sealed and open. A redeclaration admitting `null` that a declaration above refuses no longer
  admits it. **Each declaration counts where the document publishes it**: a `@header` or a
  create-only property above a response is in no schema the response is held to, and applies
  nothing there; a redeclaration that is `never`, or invisible where the model is used, leaves the
  key to the declarations above it, so `x: never` over a base's required `x` is still required, as
  the document requires it. A base's property renamed with `@encodedName` is kept beside a
  subtype's own property of the old name, and a base's property renamed to a subtype's own wire name
  is one key, where it was two and did not compile. A discriminator is required in its base and
  every model under it however it is declared, as openapi3 publishes it, and so is a property an
  ancestor requires; a default on a discriminator is reported as `default-on-required-property`.
  Declared `never`, the discriminator is the `string` openapi3 adds in its place; declared above the
  model naming it, it is held to that `string` as well.
- **A property or parameter under `@encode` validates what the document publishes for it.**
  `@typespec/openapi3` keeps the declared type's schema and replaces only its `type`, so
  `@encode("x", string) color: Color` is a string AND one of `Color`'s values. This emitter replaced
  the type outright, accepting `"green"`, dropping a named scalar's `@pattern`, and refusing the
  `null` of a nullable property the document allows. Now, as the document publishes them: `null` is
  kept where openapi3 applies the encoding beside it, `"a" | "b" | null` included, since it merges
  the two literals into one member; a union keeps only its members of the encoded type, so `Filter |
string` encoded as a string is a string; an inline object such as `{ ...Filter }` is replaced, as
  it is published inline; a scalar derived from an encoded scalar is encoded as its base is; a
  scalar with no standard base, which the document publishes as any value, is narrowed to the
  encoded type rather than refused; and a declared date-time scalar under `rfc7231`, alone or in a
  union, is validated as the HTTP-date it now is, not as the ISO date-time it no longer is. Whether
  `null` survives follows the members openapi3 publishes, not the variants written: `"a" | null |
null` is three, so the encoded type refuses `null`; a named `MaybeTime | null` is a `$ref`, which
  it refuses too; and `Opt<"a">`, a union template instance with an argument that has no name, is
  written out inline, which keeps it. Graded by Ajv for 17 kinds of declared type, each in the body
  and as a query, header, path and cookie parameter.
- **An `@encode` no value can satisfy, or which states no type, is refused** as
  `unsatisfiable-encoding`, an error. A model, a list model, an integer enum, `1.5` encoded as an
  integer, a string scalar encoded as a scalar of another JSON type, or `rfc3339` on a date-time its
  own scalar already encodes as an integer publishes a `$ref` and a `type` that contradict each
  other; an encoding to a scalar outside the standard library publishes no `type`. That includes two
  scalars whose `@encode` name each other, so `encode-cycle` is gone: it is the same refusal. `1 | 2
| null` encoded as a string leaves the document accepting only `null`, and the message says so.
- **`unenforceable-encoded-constraint` replaces `unenforceable-encoded-bound`**, a warning for any
  constraint `@encode` moves onto a JSON type it does not apply to. openapi3 publishes each beside
  the encoded `type`, where JSON Schema ignores it, and the validator now drops it too: `@pattern` on
  a string encoded as an integer emitted `z.int32().regex(...)` and `@minValue` on an integer
  encoded as a boolean `z.boolean().min(1)`, and the module threw on import with no diagnostic; and
  `@minLength` on a string encoded as an integer refused integers the document accepts. A date
  `@minValue` under `unixTimestamp` is now enforced, as the document publishes it.
- **`invalid-default`, a warning, reports a default that is no value the position accepts**, and
  drops only the fallback: one an encoding changes the type under - `@encode(string) count?: int32
= 5` filled a number the contract type says is a string - one a constraint or a declaration above
  rules out, a `null` a declaration above refuses, and an object setting a key the position does not
  declare or leaving out one it requires. Filled in, each handed the handler a value its own type
  refuses, and the module did not compile.
- **Request bodies and responses are read at openapi3's visibility, under openapi3's names.** The
  metadata view was `@typespec/http`'s default, canonical `All`, where openapi3's is `Read` with a
  read-only property shareable. A model whose create-only property is visible at `All` was not
  transformed at `Create`, so its create body was declared under the bare name and every RESPONSE
  was validated as the create view: `{ name }` refused for want of a `secret` no response carries. It
  is `WidgetCreate` now, where `Widget` is returned as well, as the document names it. And under OAS 3.1.1's reading of `readOnly`
  (section 4.8.24.3.2), **a model whose only request-side difference is a read-only property is the
  canonical schema in the request too**, as openapi3 publishes it: a required read-only property is
  required in a create or update body, where the projection `NodeCreate` dropped it, and the server
  ignores the value. A type a request reaches with nothing request-specific is rendered at `Read`, as
  openapi3's `reduceContext` renders it. The contract types follow.
- **A component is named as openapi3 names it: with a visibility suffix only where its type is used
  at more than one visibility**, openapi3's `resolveVisibilityUsage`. A model only ever sent in a
  create body is `Holder` and `holderSchema`, where it was `HolderCreate` and `holderCreateSchema`;
  one also returned is `Holder` and `HolderCreate`, as before. **A named list model is not reduced
  to `Read`**, as openapi3 emits it as an `arrayDeclaration`, which it does not reduce: `model Tags
is Tag[]` sent in a create body and returned is `TagsCreate` and `Tags`, where it was one `Tags`.
  A list literal and a union expression keep the visibility they are reached at too, so what they
  hold is judged where openapi3 publishes it.
- **A type no operation reaches is declared, as openapi3 publishes it.** openapi3 publishes every
  model, enum and union of the service as a component, reached or not, at `All`
  (`processUnreferencedSchemas`, with `omitUnreachableTypes` unset); this emitter declared only what
  an operation reached, so a model a service declares for its consumers - an event payload, a webhook
  body - had a component in the document and no validator or contract type. Each is declared now,
  rendered at `All` as the document renders it, under the document's name. A model spread as
  parameters, which the document publishes as parameters, a template declaration and an HTTP file are
  not, as the document has no schema for them. A construct this emitter refuses is now refused in a
  type nothing uses, too.
- **`@friendlyName` names a declared model, enum and union**, as openapi3 names its component:
  `@friendlyName("Gadget") model Thing` is `gadgetSchema` and `Gadget`, where it was `thingSchema`
  and two models swapping names swapped validators - reached through an anonymous copy too, a spread
  body or a returned model whose `@header` leaves its payload a copy of it, where `FooDto` had no
  validator. **A union template instance openapi3 cannot name is written out where it is used**, as
  openapi3 writes it: `Maybe<{ x: string }>`, an argument with no name, is no `maybeSchema`. **A type
  published only as a reference to another document, by `@useRef`, is refused** as
  `unsupported-type`: the document states no schema for it, and it was validated as the model
  openapi3 does not publish. A parameter carrying `@useRef` is refused the same way, and neither a
  response nor a parameter that does is walked for the models it holds, as openapi3 writes nothing
  for either: walked, its models were taken as reached at `Read` before the request that first
  publishes them.
- **Every component the document publishes is declared, validator and contract type, under the
  document's name.** One no route renders by name had neither: a model a merge holds, as
  `L1 extends L0 { m: B }` publishes `B`, and an enum an encoded list holds, whose list is published
  as the text it encodes; an envelope and a multipart body had a validator and no contract type. And
  **a list or a union instance a reduced model holds is named for the visibility openapi3 reads that
  model's properties at**, the one its first reference arrived at: `Mid { tags: Tags }`, first sent
  in a create body and also returned, is published as `Mid` with `tags` referring to `TagsCreate`,
  and `m: Maybe<Item>` there to `MaybeCreate`. The validator and the contract type refer to those
  now; `maybeSchema` and `Maybe`, where the document has no `Maybe`, are no longer declared. Checked
  across every scenario of `@typespec/http-specs`, each versioned one at the version served: the
  names declared are the document's components, a namespace dropped, apart from `special-words`,
  where openapi3 throws.
- **A tuple validates as the `prefixItems` openapi3 publishes for it**: any length, each position
  checked where it is present, anything past the last - `z.tuple([...], z.unknown())` with every
  position optional, and `[A?, B?, ...unknown[]]` as its contract type - each position at the
  visibility of the model holding it, as openapi3 writes it out there: `HUpdate`'s `[El, string]` is
  `[ElUpdate, string]`. 0.30.0 emitted no rule for a
  tuple at all; refused instead, an OAuth2 flow model, whose `scopes` is a tuple and which openapi3
  publishes as a component, would stop every service using `OAuth2Auth` compiling. A parameter or a
  response header typed as a tuple is refused as `unsupported-type`: openapi3 publishes `prefixItems`
  over the values it carries, which are text on the wire, and nothing here reads them as positions.
- **`split-visibility`, an error, refuses a schema openapi3 publishes with its properties and its
  `required` read at two visibilities.** openapi3 writes each component from the first reference
  that reaches it. Where that is a request's and the model has nothing the request reshapes, its
  asset emitter reads `required` at `Read` and the properties at the request's visibility, so a
  read-only `id` is required and not declared - which no value satisfies under
  `seal-object-schemas` - or, optional, left out, and a sealed response refuses the `id` it carries.
  Every use of the component shares that schema, responses and every subtype holding it through
  `allOf` included. A model expression or an inlined template instance is cached the same way and
  written out again wherever it is used, so it is judged by the emission openapi3 caches. Measured:
  `Outer { @visibility(Create) secret; inner: Inner }` sent to a create operation, with `Inner`
  returned only by a later one, publishes `Inner` as `required: [id, name]`, `properties: {name}`.
  A key the schema declares some other way is not misread: a base declaring it, an indexer covering
  it, a subtype's own properties redeclaring it, or the discriminator openapi3 adds back.
  The emitter follows openapi3's emission order - operations by route, an operation openapi3 drops
  for a query string in its path skipped, each one's parameters, then responses, then request body,
  a shared route's parameters grouped by name, the types no operation reaches last - to find which
  reference writes each schema, and refuses the ones written split, once per declaration, rather
  than validating a schema the document does not hold. A subtype a dispatch would hold, or a merge,
  leaves such a model out, as no value. Sending the request's own view, `@body body:
Create<Outer>`, publishes the request apart and the shared components as declared; the message
  names it.
- **`header-case-collision`, an error, refuses two header parameters whose names differ only in
  case**, `x-foo` and `X-Foo`: HTTP reads them as one header, and openapi3 publishes two parameters
  of its one value. Validated as either, a value the other refuses was served.
- **An instance of a list template is refused** as `unsupported-type`: `model Page<T> is T[]` makes
  `Page<Item>` a template instance, which openapi3 publishes as an object of its elements, not a
  list. A named list per element type, or `Item[]`, is a list in the document too.
- **A list literal's elements are read at `Item` visibility**, as openapi3's
  `arrayLiteralReferenceContext` reads them: PATCH leaves a list's items required, where it made
  every item's properties optional, and a `@header` on an element is data, where it dropped out of
  the list. An element model that differs there is declared under the document's name - `TaggedItem`,
  `NodeCreateItem` - where it shared the list's own.
- **Each model in a chain is read at the visibility it is rendered at**, as openapi3 renders each
  `allOf` link: a subtype's create body is `allOf` a base with nothing create-specific, which is the
  canonical schema, so the base's read-only property is required there under OAS 3.1's reading,
  where it dropped out. A union a request reshapes is declared per visibility as a model is -
  `WidgetOrCreate` - where one declaration served request and response.
- **The topmost indexer in a chain holds every key it does not declare**: openapi3 publishes a root
  model's indexer as `additionalProperties` and a lower one's as `unevaluatedProperties`, which the
  root's has already evaluated. A subtype's own key is held to its base's `...Record<Inner>`, and a
  subtype's own indexer below a base's applies to nothing; read as the nearest, the first escaped and
  the second refused keys the document accepts.
- **A `@oneOf` union is exclusive**, validated as `z.xor`: openapi3 publishes `oneOf`, and a value two
  members accept is refused, which `z.union` accepted. On a property, `@oneOf` makes its inline union
  exclusive, as openapi3 makes it.
- **A parameter's text reads as a number only in JSON's number grammar**: `"0x10"`, `"007"` and
  `" 5"` are no longer numbers, so `int32` refuses them as the document does, and `"007" | int32`
  keeps the `"007"` it accepts, where it became `7`. A query list with an array encoding is joined
  with the encoding's delimiter whatever `explode` says, as the `style` openapi3 publishes joins it.
- **Inside an explicit `@body`, a metadata property is data**, as `@typespec/http` ignores the
  annotation there and openapi3 publishes it, constraints and all: `HBase`'s `@header("x-code")
@maxLength(3) code` under `@body body: HSub` is a body property of at most three characters, which
  the validator dropped - a gap this emitter listed. One model used both inside an explicit body and
  outside one is two shapes under one name, and is refused as `duplicate-declaration`, as openapi3
  refuses it as `duplicate-type-name`.
- **A body declared `never` is refused** as `never-body`, an error. openapi3 publishes it as any
  JSON value, and 0.30.0 read it as no body and listed the divergence as a known limit; `void`
  declares no body and is published as none.
- **`invalid-subtype-discriminator`, an error, refuses a subtype the mapping names that no dispatch
  can hold**: one whose discriminator is not a fixed value - `kind: "lab" | string`, or `kind`
  renamed with `@encodedName` - which made Zod throw on import or on every parse, and one whose
  value a declaration above it refuses, such as `kind: "cobra"` under `@maxLength(3)` or under a
  union whose scalar's base declares it, which no value is. The base dispatches to its other
  subtypes, and the subtype used directly validates nothing, as the document's does.
- **`sealed-base-extended`, an error, refuses a template instance that adds a required property to a
  base openapi3 seals.** Under `seal-object-schemas` openapi3 does not count `Pet<string>` as a
  derived model of `Animal`, seals `Animal`, and so refuses every `Pet<string>` carrying a property
  it adds; the validator accepted them. An optional property it adds is left out, so the sealed
  object refuses it as the document does, and `model PetString is Pet<string>` is counted as derived
  and leaves `Animal` open.
- **`undeclared-discriminator` also refuses an envelope-less `@discriminated` variant whose
  discriminator is not one fixed value**, such as one inherited as an open `string`, and matches the
  discriminator by its wire name only. Both made the module throw "Invalid discriminated union
  option", on import or on every parse. **A variant no value can be is left out of the dispatch**,
  as the document's `oneOf` accepts what its other members do: one whose discriminator a declaration
  above it refuses, and one a sealed base leaves no value of, reported as `sealed-base-extended`. In
  the dispatch, the second put a `z.never()` where Zod reads a literal, and every parse threw.
- **`unrepresentable-override`, an error, refuses a redeclared property whose merge with a
  declaration above it refers back to itself**: two unrelated recursive models, one redeclared over
  the other. This emitter declares no recursive merge, and says so rather than validating the value
  against one of the two.
- **`ambiguous-form-reading`, an error, refuses a `@oneOf` body sent as a URL-encoded form where a
  member may read one text two ways and another member accepts one and not the other.** The
  document accepts the form where some reading of its text matches exactly one member: `x=5` against
  `M { x?: int32 | string }` and `N { x?: int32 }` is `{ x: "5" }`, `M` alone. Each member's
  reading is the first its schema accepts, `5`, which matched both, and the form was refused.
  Finding the reading that matches one member means trying every combination of every key's
  readings, exponential in the keys, and a record's keys are the sender's to choose, so the body is
  refused instead. A `@oneOf` whose members read each key alike is validated as before, and so is
  one where every rival requires a key it refuses as the other member reads it, as a `kind` literal
  does; a discriminated union is no such `oneOf`. Give the key one reading, declare it alike in both
  members, or remove `@oneOf`.

### Fixed

- **A form-exploded query of a list or a scalar beside a record or a model is read as either.**
  `x?: int32[] | Record<int32>` is `?x=1&x=2` as the list and `?a=1&b=2` as the record. The
  record's gatherer took the parameter's own name as one of its keys, so the list member was handed
  `{ x: ["1", "2"] }`: `?x=1&x=2`, `[1, 2]` in the document, was refused for every such union, and
  `?x=007` and `?x=x` for `string[] | Record<int32>`, which 0.30.0 accepted. The query is gathered
  once; each object member reads the object, and each list or scalar member what arrived under the
  name.
- **A form-exploded model's own name, sent where the model declares no such key, is an extra
  parameter**, as the document reads it: `?f=5` beside `f?: F`, `F { x?: int32 }`, was refused as
  `f: expected object` while `?zzz=5` was accepted.
- **A `{;v*}` path parameter of any type reads the list or the object its expansion spells.**
  `unknown`, a scalar with no standard base, or `string | unknown` refused `;v=1;v=2` (`[1, 2]` in
  the document) and `;a=1;b=2` (`{ a: 1, b: 2 }`) as not the expansion the route declares.
- **A parameter declared `never` is left out, as the document leaves it out.** A `@query`,
  `@header` or `@cookie` of type `never`, spread or not, was validated as `z.never()`, refusing
  `?a=1` where the document accepts it as an extra parameter, typed `never` in the handler's input,
  and reported as `unsupported-type` at `<unknown location>:1:1`. A refusal inside a parameter's
  type now points at the parameter.
- **Every emitted module loads.** A spread body's model was named by the usage of the copy it was
  reached through - one visibility - so `create(...User): User` declared `userSchema` twice; it is
  named by the model's, `User` and `UserCreate`. A model PATCH sends with and without implicit
  optionality is two schemas under one name, `XUpdate`, which openapi3 refuses as
  `duplicate-type-name`; both were declared, and the module did not parse. It is
  `duplicate-declaration` now, once, and one declaration validating nothing, as every such collision
  is - each was reported twice, once by each walk.
- **A `@discriminated` envelope is declared per visibility it is published at**, `PetCat` and
  `PetCatCreate`, its `kind` and `value` optional under a PATCH that makes them so, as openapi3
  publishes it; one wrapper served every visibility. A discriminator a PATCH makes optional is no
  dispatch, so such a union is `z.xor` of its members, the document's `oneOf`, envelope or not.
- **A cyclic declaration's annotation names the declarations it is annotated with**, at the visibility
  the declaration is keyed on; read at the one it was requested at, a discriminated base reached
  from a create body named a `DogCreate` nothing declared.
- **`@oneOf` stays exclusive across nesting.** A `@oneOf` over a plain union, and a plain union over
  a `@oneOf`, were spelled out into one list of members with one combinator: merging two `@oneOf`
  unions refused every integer an `int32 | float` member admits, and a redeclaration narrowing into a
  union holding a `@oneOf` accepted a value two of its members accept.
- **Merged values are read at the visibility each declaration is published at**: a record's values
  at the record's, so a PATCH no longer makes them optional, and a list literal's elements at `Item`
  beside a named list's, which keep the list's own. A record's value keeps its visibility where it
  is the one schema a key is held to, too: rendered at the merge's, `Record<M1>`'s values beside an
  open model under a PATCH were a second `M1` under its one name, refused as `duplicate-declaration`
  where the document has one `M1`. And a model is no longer taken to narrow itself at another
  visibility: `QX { x: M1 }` sent in a PATCH beside a `Record<M1>` holds `x` to `M1Update` and to
  `M1`, and accepted an `x` without the `c` `M1` requires. A list literal redeclared over a named
  list, or the reverse, is merged where their elements differ at those visibilities: under a PATCH,
  `u: El[]` over `u: Els` holds each element to `El` and to `ElUpdate`, where it took `ElUpdate`
  alone and accepted an element without the `e` `El` requires. One model merged at two visibilities
  keeps both, an envelope's `value` is at the envelope's, and a key only one of the merged models
  declares is at that model's.
- **A named union is declared** where a property is typed with it, `m: MaybeN1<Item>`, as the document
  publishes `$ref: MaybeN1`; its validator was written inline and the contract type had no pair.
- **A multipart part, a shared parameter and a shared route are read where openapi3 publishes them**:
  a part as the model it stands for, collapsed to `Read` as a request body is, where `@typespec/http`
  hands over a copy without what the request cannot see; a parameter spread from a named model at the
  visibility of the first operation sending it, whose component every later one refers to; and every
  operation of a shared route at the first one's request visibility.
- **A form-exploded query typed as a union of models is gathered once**, each member then reading
  the values its own way - only the last member's keys were gathered, so `?kind=a&x=1` was refused;
  a model gathers only the keys its validator declares where it is used, so a create-only property
  on a GET is no key; a value that may be one value or a list, `int32 | int32[]`, reads `?e=1&e=2` as
  the list; and a discriminated header reads the properties of the subtype it names.
- **A repeated multipart part sent once is the one-element list** the document describes, as an
  exploded query's lone value is; a form hands it over as the one value. The request validator boxes
  it, and only text or a file, and the component stays the document's schema. A part whose type mixes
  text with a model or a list, published `text/plain, application/json`, is read as JSON where its
  text is JSON the schema accepts.
- **`invalid-default` asks the check its own scalar emits**: a `plainDate` of February 30th, a `url`
  that is no URL, and a date past what its `int32` timestamp encodes were filled in and refused when
  sent back. An `int64` default past what a JSON number holds is reported as that, not as `null`.
- **A name outside printable ASCII is written as openapi3 writes the component key**, `Caf_` for a model
  named `Caf` and an accented `e`, and in a comment as its escape; generated files stay printable ASCII.
- **A discriminated base's dispatch never throws.** A subtype refused as `split-visibility` sat in
  `z.discriminatedUnion` as `z.never()`, and every parse of the base threw.
- **A dictionary of nothing is written `{}` in the contract types**, as an empty model is, and the
  wire contract compares the contract with its intersections written out, as it already compared the
  validator; both had read one shape as two.
- **A discriminated base dispatches to the models its mapping names.** Built from its direct
  subtypes, a base with a subtype that declares no discriminator threw on every parse.
- **No `.refine` is emitted for a discriminated base.** 0.30.0's guard was dropped by
  `z.toJSONSchema`, so the schema derived from a validator - an MCP tool's `inputSchema` - admitted
  values the validator refused. The guard is gone, and the behaviour suite now checks that the
  schema Zod derives from each corpus base answers as the validator does.
- **A diagnostic is reported once per declaration.** The compiler hands out a copy of a declaration
  for `model B is A`, for a spread into each operation, and for each versioning projection - one per
  emitter that asks - and each copy was reported: twice through `model B is A`, and every diagnostic
  twice where `typespec-hono` and this emitter compiled one versioned service.
- **`ISO8601` on a duration is the form a duration already has**, as `rfc3339` is on a date-time,
  and is validated as a plain `duration` is.
- **A constraint on a union property, encoded or not, no longer stops the module loading.** It
  emitted `z.union(...).min(2)`, which is not a function. Each member now takes the property's
  keywords for its own JSON type, as JSON Schema applies them, and a literal member they refuse is
  no value; a member with no type of its own, `unknown`, is any JSON value with the keyword applied
  to the kinds it applies to; under an encoding, the constraint goes on the encoded scalar beside
  what it keeps.
- **A scalar-constructor default is emitted as the value the document publishes**, alone or inside a
  list or object: `utcDateTime.fromISO("2020-01-01T00:00:00Z")` is that string, and under
  `unixTimestamp` the number `1577836800`. It was refused as `unsupported-default`. A default that
  is no value of the property's type - through the property's encoding or its scalar's - is dropped
  and reported as `invalid-default`, and a property refused as unsatisfiable takes no default, where
  `z.never().default(...)` did not compile.
- **A parameter that may be `null` is read as the value it carries**, since no parameter carries
  `null`: `?ids=1,2` for `ids?: int32[] | null` was handed to the list schema unsplit, and a
  form-exploded `filter?: Filter | null` was never gathered, so its keys were stripped. A cookie
  list is split, as the document's `form` style joins it.
- **An operation's validators have identifiers whatever its id.** An operation named `exploded` had
  a query validator named `explodedQuery`, the name of the helper the module declares for an
  exploded query object, and `@operationId("get-widget")` made `get-widgetQuery`, which did not
  parse. A character no identifier holds becomes `_`, and a name already taken takes a trailing `_`.
- **A parameter's text is read as the value its schema says it is**: the first of a number, a
  boolean and the text itself that the schema accepts. Read by a kind decided from the type, a
  numeric enum, `int32 | boolean` and `int32 | "all"` were never read, and refused every value the
  document accepts. A record or a model in a header or a cookie is read now - `a,1,b,2`, and
  `a=1,b=2` from an exploded header - where its text met the object's schema whole; a model's values
  in a query are read as its properties say, where they stayed text; and an exploded header list is
  split, where it was boxed whole, since `simple` style joins a list with commas either way.
- **Into a union of declared scalars, an override is held to the member it is.** `Digits2` under
  `Lower | Digits` was held to `Lower`'s pattern and `Digits`' at once, and accepted nothing; it is
  merged member by member where two members could hold it. A `null` a list's element or a record's
  value takes is refused where a declaration above refuses it, and a named list model's own
  `@minItems` on the declaration above holds where the override narrows it.
- **An envelope on a cycle loads**: its `value` is reached through a getter, as an object's member is,
  where it read its variant before the variant's `const` - "Cannot access 'catSchema' before
  initialization" - and a cyclic envelope union is a type alias, where it was written as an
  `interface` and did not parse.
- **A record's or a model's values are read by their own key**: a key named `constructor` or
  `toString` found `Object` on the prototype and the parse threw; a model with an indexer read its
  declared text properties with the indexer's reading; a list property of an exploded model was never
  boxed or read; and a label expansion's value holding its `.` - `{.r*}` with `a=1.5` - was refused. A
  union of a scalar and a list or a model is read each way its style allows, where only the scalar
  reading was tried, and an exploded model leaves a key another query parameter is named to it.
- **Two parameters of one location and one wire name are validated as the first**, as the document
  publishes only the first, where both were intersected and every value refused; `shared-input-key`
  says so.
- **`invalid-default` holds each key a default sets to every declaration above it, at any depth, and
  a merged value to the whole merge.** `o?: KS = #{ k: "toolong" }` was filled in where `KS extends
KB` and `KB` declares `@maxLength(3) k`, and so was `B2`'s `k = 7` into the branch of
  `Root { u: B | A }` where `A`, a `Record<Small>`, refuses it: each handed the handler a value its
  own validator refuses.
- **`invalid-default` reports a default its own keywords rule out**, the property's, a declaration's
  above it and its scalar's - `@minValue(10) mv?: int32 = 5` filled a `5` the same validator refuses
  when sent. `default-on-required-property` says a key required by a declaration above it is that,
  where it called it a discriminator.
- **`unsupported-type` is reported once per declaration**, where both walks reported it, and says
  why a tuple parameter is refused; `duplicate-declaration` points at the model, where it pointed
  nowhere.
- **An operation id that closes a block comment leaves the module parsing.** `@operationId("list*/items")`
  ended the comment naming it in `requests.gen.ts`, and the rest of the line was code.
- **Every component that is a value rather than an object is probed** by the behaviour suite, so 22
  enum and union validators are compared with the document that were not.
- **A URL-encoded form body is read from the text it carries**: `n=5` is the `int32` 5, `b=true` the
  boolean, and a key sent more than once the list it stands for. Validated as JSON, every numeric
  or boolean field of a form refused every conformant request. Where the body is also taken as
  JSON, `EmittedRoute.formRequestSchema` and `RouteSchemaNames.formBody` carry the form's validator,
  and JSON is still validated as JSON.
- **A record's or a model's values are read from text as the validator holds them**: a key as its
  most derived declaration, at its position - `Sub { x?: string }` under `Base { x?: int32 | string }`
  read `"5"` as `5` and refused it - every other key as the indexer the chain enforces, the topmost,
  and a discriminated base as the subtype its discriminator names, where a key two subtypes declare
  was read as the first's. A lone value is boxed into a list only where a key repeats, a
  form-exploded query and a form: in a path, a header, a cookie or a non-exploded query, `l,1` was
  `{ l: [1] }` where the document refuses it, and `l,1,l,2` dropped the first value. Two
  form-exploded objects declaring one key each read it, where the first took it and the second
  refused its absence. A mixed text-or-JSON part reads any JSON value its text spells, `"all"` and
  ` 1` included, not an object alone.
- **A default its scalar's own `@encode` writes is filled in**, `Ts.fromISO(...)` as the timestamp it
  publishes, where it was reported as `invalid-default`, and a default no value of its encoded type
  is reported as that, not as breaking a keyword the validator drops.
- **A model named `SPEC_VOCABULARIES`, `WireReader`, `WireReaders`, `ArrayBuffer` or `Uint8Array` is
  declared with a trailing `_`**, as a name the generated files declare or name for themselves, so
  the set loads and typechecks: `SPEC_VOCABULARIES` is imported, the reader tables are typed
  `WireReader`, and a multipart file's `arrayBuffer: () => Promise<ArrayBuffer>` and a stream's
  `Uint8Array` chunks name the library's.
- **`duplicate-declaration` says what made two types one name**: a visibility suffix spelling
  another type's name, two names differing only in the case a validator's name lowers, a character
  an identifier cannot hold, two instances of one union template, a multipart body or a union
  holding `bytes` in a multipart part beside its other use, and an envelope; it said a namespace for
  every one. **A multipart body and a JSON body of one model are one refusal in either order**,
  where the JSON body declared first left `formSchema` declared twice and the module did not load.
- **A dispatch never holds a subtype refused as a collision**, which threw on every parse of the
  base and did not typecheck: one rendered before the refusal is rendered again without it. **A
  contract type is `never` wherever its validator validates nothing**, so the wire contract
  typechecks where a refused model, union or collision kept its shape on one side.
- **Merges, as the document nests them**: a `@oneOf` nested in a `@oneOf` stays one member, as
  `oneOf(oneOf(a, b), c)` is not `oneOf(a, b, c)`; a `null` a nested union admits is a value of the
  merge; a nested union meeting a model is merged member by member, where the two were joined with
  `.and()`, which threw on two defaults and pooled keys a sealed side refuses; a member with no type
  beside an envelope is its keywords, where it was refused as an `Envelope`; a merged exclusive
  union keeps its exclusivity where its members are strings; a merged envelope's `kind` and `value`
  are optional under a PATCH, and its members exclusive, as the `oneOf` openapi3 publishes; a list
  literal's element keeps `Item` beside a named list's; and an enum a constrained string narrows is
  read as its members, where `colorSchema.max(3)` threw on import.
- **A literal repeated in a `@oneOf` is one member**, as openapi3 publishes every literal of one JSON
  kind as one `enum`: `1` repeated matched twice and was refused.
- **`null | null` is `null`**, where it was refused as `empty-union` and its contract type kept.
- **A model with an indexer and no member where it is used is a dictionary in its contract type**,
  as it is to the wire assertion, and two empty objects in a union are one there too.
- **A spread body is the model openapi3 resolves it to, its base's properties included**, so
  `...HSub` beside an explicit `@body body: HSub`, whose base holds a `@header`, is refused as the
  collision openapi3 reports - for `HSub` and `HBase` both - where the body written out inline
  validated what the document does not.
- **`invalid-subtype-discriminator` says a renamed discriminator publishes the `string` openapi3
  adds**, where it said nothing, and that a discriminator declared where the request cannot see it -
  `@visibility(Lifecycle.Read) kind: "dog"` in a create body - is not visible there, where it told
  the author to declare the value already declared.
- **A shared route's parameter is read as the one openapi3 publishes for its name**: where every
  operation declares it alike, the first's, so a spread model only a later operation sends is
  published from that operation, at its visibility; and a spread model only that one uses is
  declared, as the type no operation reaches it then is.
- **A `bytes` member of a multipart part's union is any value**, as openapi3 publishes it raw:
  `HttpPart<bytes | string>` refused every file. Where JSON is the only media type the document
  publishes for the part, `HttpPart<bytes | null>`, its text is still JSON: `x` is refused and `5` is
  the number 5.
- **A spec's own type named like a standard one is read as the spec declares it**: `scalar uint8
extends string` is a string, `scalar bytes extends int32` an integer, and `model File` sent as a
  part a JSON object, where each was taken for the standard type of its name. **A model named
  `Record`, `Promise`, `Readonly` or `Exclude` is declared under that name**, as openapi3 publishes it -
  `Create<T>`'s copy of a `Record<I>` included - and every emitted file names the library's own as
  `globalThis.Record<...>`; it was validated inline with no contract type, or, declared, it shadowed
  the library type the file used, which then took no arguments.
- **A value is read from text wherever its type admits a number or a boolean**: a member that takes
  any value, `unknown` or a scalar with no standard base, so `@maxLength(2) a?: string | unknown`
  sent `?a=12345` is the number 12345, which no `maxLength` constrains, where it was refused as too
  long - in a query, header, cookie, path, query object and URL-encoded form; a union holding a list
  in a position where a key repeats, `ll?: int32[] | string[]` sent `?ll=1&ll=x`, read by the whole
  union, and `?ll=x` as the list `["x"]`; and a URL-encoded body typed as a union of models, or as a
  model or `null`, read member by member.
- **An object default that leaves out a key with a default of its own is filled with it**:
  `inner?: Inner = #{ b: "x" }`, where `Inner` declares `a?: int32 = 1`, is `{ a: 1, b: "x" }`. The
  validator's `.default({ b: "x" })` did not typecheck.
- **A body is validated as the model openapi3 resolves it to**, its effective payload type: an
  explicit `@body body: { ...Foo; @header h: string }`, a response of that shape, `Pet & {}`,
  `@bodyRoot body: { @header h: string; ...Pet }`, each published as `$ref`, were validated as the
  inline object written, `h` required. **A spread `{ ...X }` anywhere else is written out where it
  is used**, as openapi3 writes it, where it was validated as `X`: a discriminated base, which then
  dispatched to subtypes the inline object refuses, or a model refused elsewhere as
  `split-visibility`.
- **A `@discriminated` dispatch holds only what it can read a value from**: a variant with no
  envelope that is a `@discriminator` base itself, a `z.union` with no literal, and a recursive
  declaration annotated `z.ZodType<T>`, which erases the literal. In the dispatch, the first threw
  "Invalid discriminated union option" on every parse, and the second did not typecheck; each sits
  beside it, as a nested base does beside a base's own dispatch.
- **A visibility template of a `@discriminator` base dispatches only to subtypes published as `allOf`
  it.** `Create<Pet>` is a model of its own, published by its own properties, its mapping naming the
  canonical `Cat`; dispatched to `Cat`, it accepted the `B` that `CreatePet` holds as `CreateB`.
- **A `@oneOf` refuses the `null` more than one of its members matches**: openapi3 publishes each
  `null` variant as a `{ type: "null" }` of its own, so `@oneOf unknown | null` and
  `@oneOf union { a: "x", b: null, c: null }` refuse `null`, which `.nullable()` accepted. A
  redeclaration over a `@oneOf` whose members are typeless is held to that union, which accepts no
  value or no `null`, where it was taken for any value.
- **A merge holding a declaration refused as `duplicate-declaration` validates nothing**, as a merge
  holding one refused as `split-visibility` does, and its contract type is `never` too; built from
  the refused declaration's own shape, `SubCreate` accepted what the document refuses.

- **A declaration is read where openapi3 reads its model's properties**: at the visibility the
  reference that writes the model arrived at, so a read-only declaration a create body leaves out of
  the properties no longer holds the key. `X { @visibility(Read) @maxLength(2) id; ...Record<string> }`
  validates `id` as the indexer's `string`, `Z extends Base { @visibility(Read) id: "abc" }` as
  `Base`'s `id`, and a read-only discriminator as the `string` openapi3 adds; each refused a value
  the document accepts, and `Qq extends P` was refused as `invalid-subtype-discriminator` for a
  `@maxLength` the document does not publish.
- **`split-visibility` no longer refuses a model whose schema declares the key some other way** - a
  base, as that base's own schema publishes it, or a subtype that declares the optional key its base
  drops. `IRB extends RBase`, both declaring a read-only `id`, was refused though the document holds
  it as declared.
- **A merge keeps what each declaration says**: a `null` a declaration above refuses is left out of a
  `@oneOf` member that holds it; a literal is held to the check its declared scalar emits, so
  `@oneOf { Color, string }` under `utcDateTime` no longer accepts `"red"`, which matches two members;
  an envelope a merge spells out is published where its union reduces to, `kind` and `value`
  required under a PATCH where the document requires them; a nested `@discriminated` union stays one
  `oneOf` member; and a member is read at the visibility its declaration is published at, so a list
  literal's `M13` under a PATCH is `M13`, `d` required, with no stray `M14Update`.
- **A `@discriminated` union is narrowed into one variant only where its discriminator tells every
  variant apart**, and a variant whose refused discriminator a PATCH lets it leave out is kept: under
  `kind?`, or any discriminator under a PATCH, `{}` is two variants, which the document refuses.
- **A `@oneOf` holding a refused member validates nothing**, as a merge holding a refused declaration
  does, and the declaration a value is merged into reports why: `z.xor` counted the refused member
  as matching nothing, so a value it and another both match was accepted. **So does one whose member
  holds a refused declaration further down**, which holds the member stricter than the document and
  so counted a value both match as one: `@oneOf { v0: M16, v1: M13 }` with `M13`'s `c` refused as
  `split-visibility` accepted `{ c: {...}, e: "red" }`. And a member refused only as it is written is
  counted too: the `@oneOf` was written holding it, while its contract type was `never`, and
  `wire-contract.gen.ts` did not compile (`TS2344`).
- **A reference to a union variant, `v: U.a`, is the variant's type where it is used**: under a PATCH
  it is `IRUpdate`, as the document publishes it, and it can be `split-visibility`.
- **A type published at two visibilities under one name is the one the document keeps**, the one
  written last, where openapi3 reports `duplicate-type-name` on its own document: `Dog` in a discriminator mapping, `D` reached through its base, and `M` in a tuple were
  refused as `duplicate-declaration`, and `G extends K` held a create-only key the document's `K`
  leaves out.
- **A shared route's parameter is optional where openapi3 publishes it so**, whichever emitter runs
  first: openapi3 sets `optional` on the declarations as it emits, so `sa(@query q)` beside
  `sb(@query other?)` validated `q` as required alone and as optional after it.
- **A record under a PATCH is annotated with the view its value is published at**: `Record<M4>` is
  `Record<string, M4>` in a cyclic declaration's annotation, where `M4Update` named nothing
  (`TS2552`). **A member repeated in an `anyOf` is written once**, on both sides of the wire
  assertion, which told two identical objects from the one `Record` (`TS2344`).
- **A remedy works where it is pasted**: `split-visibility` and a visibility `duplicate-declaration`
  name `declare 'model OuterCreate is Create<Ns.Outer>;' and send it ... through '@body'`. Named as
  `Create<Outer>`, the view inherited a `@friendlyName` and collided; spelled by the friendly name or
  without its namespace, it named nothing; and through a spread, `...Create<O1>`, it changed nothing.
- **A URL-encoded body holding any union is read from its fields**: an envelope-less `@discriminated`
  union, by its discriminator; an enveloped one as `{ kind, value }`; a union nested in a union; and
  a union with a member a form can never be, which the document refuses as the validator does. They
  were validated as JSON, every number refused as a string.
- **A multipart part published as a list under a text media type is that many parts**, one per
  element, as the same part declared `HttpPart<T>[]` is: `HttpPart<{ contentType: "text/plain";
body: int32[] }>` sent once refused `5`. A part that may be JSON is boxed only where its text is
  not the JSON list it accepts.
- **An object default beside a typed indexer typechecks**: `r?: ObjIdx = #{ s: "x" }`, where
  `ObjIdx { s?: string; ...Record<int32> }`, is filled by parsing the literal, as Zod types
  `.catchall()` over every key and no literal setting `s` is a value of that type (`TS2769`). **A
  default a literal declared above refuses is `invalid-default`**, where it was emitted and the file
  did not typecheck.
- **Every reference to a library generic is written `globalThis.Record<...>`,
  `globalThis.Promise<...>` and so on, by the emitter where it writes the reference.** A rewrite of
  the finished file had turned the spec's own text - a literal `"Record<k>"`, a `@pattern`, a
  default, a description, an enum value - into `"globalThis.Record<k>"`, so a validator refused the
  literal the document accepts, and the wire assertion failed.
- **Every name TypeScript refuses for a declaration takes the trailing `_`**: the predefined types
  (`any`, `string`, `never` and the rest), the strict-mode reserved words a module is held to
  (`interface`, `public`, `let` and the rest) and the type operators (`keyof`, `infer`, `readonly`,
  `unique`), read from the TypeScript compiler's own keyword table. Each was declared as written,
  and the file did not load or typecheck. The rename is decided on the published name, suffix
  included: `WireReader`'s update view is `WireReaderUpdate`, where it was `WireReader_Update`.
- **A model named `Array` is a list literal, as openapi3 reads it**: `@minItems(1) model Array is
int32[]` publishes no `minItems`, and its validator no longer refuses `[]`.
- **A union that reaches itself through union members alone is refused as `unsupported-type`**,
  and its service emits nothing. `union string { int32, string }` in a namespace names itself, not
  the scalar, and openapi3 publishes `anyOf: [int32, { $ref: string }]`, which JSON Schema leaves
  undefined: Ajv overflows its stack on every value. Used as a query, header, path or form field,
  the emitter crashed with "Maximum call stack size exceeded"; as a body property it emitted a type
  alias TypeScript refuses and a validator that recursed on every value but an integer. Each union
  on such a cycle is named, reached or not. A cycle through a list, a record, an object or an
  envelope is a recursive type like any other, and is unchanged.
- **A merged union is the same members in the validator and the contract type.** `S` merged under
  `M1 | M2` is two objects, one holding `b` to one `@minLength` and one to two, and the validator kept
  both; the contract type, deduplicated by its own text, wrote one, and TypeScript does not count a
  union of two such objects identical to one, so `wire-contract.gen.ts` did not compile (`TS2344`).
  The contract type now writes the members the validator writes, one of each text it writes, and a
  dictionary it would write twice, `Record<string, unknown>` - one type to TypeScript, where a
  `@oneOf` of two alike merged members is two objects to Zod - as an object of its own each time.
- **A property's `@oneOf` is a `oneOf` under a redeclaration too.** `Root { @oneOf u: X1 | X2 }`
  beneath `Leaf { u: S3 }` merged `S3` into each member and joined them with `z.union`, so
  `{ u: {} }`, which both members match and the document refuses, was accepted.
- **A union refused as `duplicate-declaration` takes its envelopes with it.** openapi3 publishes a
  `@discriminated` union's envelopes wherever it publishes the union, each under its one name:
  where `DU7` is refused for two views under one name, the document keeps the envelope written
  last - `DU7Y` from a PATCH, its `kind` and `value` optional - while the validator held the view
  first declared, requiring both. They are refused with the union, whose diagnostic says why.
- **`split-visibility` judges every key a base's schema misreads, not its first.** `S extends B {
@visibility(Lifecycle.Create) k: string }` under a `B` whose document `required` names `k` and
  `bid` but whose properties declare neither declares `k` itself, and not `bid`; judged by `k` alone,
  `S`'s create views were validated as declared and accepted a `bid` their sealed `allOf` refuses.
  They are refused now, as `B` and `S` are.
- **A multipart JSON part the document publishes as a list reads one text as the list's JSON or as
  its one element, however it is declared.** `HttpPart<int32[]>` and `HttpPart<{ @header
contentType: "application/json"; @body body: int32 }>[]` are published alike, `{ type: array,
items: int32 }` under `application/json`, and OAS 3.1 does not say whether such a part is sent
  once or once per element. The first refused `5` and `1` and `2` sent as two parts; the second
  refused `[1,2]`. Both now read `[1,2]` as the list, and `5`, or the two parts, as its elements. A
  repeated part that may be text or JSON reads `[1,2]` as the list too.
- **A multipart text part of a union holding a list is one value, or several sent as as many
  parts**, as a URL-encoded form's field is: `int32 | int32[]` under `text/plain` refused `1` and
  `2` sent as two parts, `[1, 2]` in the document, and `int32 | string[]` refused a lone `a`, the
  list `["a"]`.

### Added

- **`EmittedRoute.textParts`: the multipart parts a server reads from text**, each with whether it
  is JSON alone - every part but a file and raw bytes. A client may send one with a filename, and a
  form reader then hands it over as a file, which the part's schema, reading text, refuses; the
  part's media type says what it is. `typespec-hono` reads such a part's text first, and refuses a
  JSON part naming the object prototype as it refuses a JSON body.

### Documented

- **A record or open object accepts a `__proto__` key and drops it, whatever its value**, where the
  document refuses one its value type does not admit: Zod strips the key before any schema runs
  (colinhacks/zod#6386). Measured on Zod 4.5.0 and 4.6.5. A sealed object refuses it, as the document
  does. The reference names where to close it - the JSON parser, as Fastify and hapi do by default -
  rather than working around Zod's guard in every validator.
- **A `/` path expansion is decoded as the route declares it.** `{/v*}` is RFC 6570 path-segment
  expansion, `/files/a/b`, as `@typespec/http-specs` expects; openapi3 publishes it without its
  operator, `style: simple`, under its own `invalid-style` warning, and so describes `/filesa,b`, a
  URL the route does not match. The validator undoes the expansion the route declares.
- **A shared route's parameter declared as two types is validated as each operation declares it**,
  as a router dispatching between them needs, where openapi3 publishes one parameter per name - the
  first operation's. Where a parameter is missing from one operation, or declared unalike, it is
  optional, as openapi3 publishes it.

## [0.30.0] - 2026-10-16

Upgrading: [what to check before you take this](docs/guides.md#to-0300).

### Changed, breaking

- **A `@discriminator` base validates a value naming no subtype as the base itself.** The document
  publishes the base as an object of its own properties beside `discriminator.mapping`, and OAS 3.1.1
  section 4.8.25 says the keyword "MUST NOT change the validation outcome of the schema". The base was
  a `z.discriminatedUnion` over its subtypes alone, so `{ "kind": "wrongKind", "weight": 8 }` was
  refused for a `Dog` whose `kind` is `string | "golden"` - the response `@typespec/http-specs`
  declares in `enum-discriminator`, `single-discriminator` and `nested-discriminator` - and a handler
  returning it failed its own response contract. An open base is now
  `z.union([dispatch, ...nested bases, base arm])`. The base arm's discriminator refuses every value a
  subtype claims, so a value naming a subtype is still that subtype, sealed where it is sealed, and
  never falls through to the base. A closed discriminator every member of which a subtype claims is
  emitted as before, and refuses a value outside it. The base's TypeScript type gains the same arm,
  `Golden | { kind: DogKind; weight: number }`, so narrowing on `kind` no longer excludes the base. A
  differential arm, `discriminator-open`, compares the arm with what the document's base admits, over
  the corpus.

### Changed

- **A body declared `void` or `never` lists no media type.** `@typespec/http` keeps an explicitly
  declared empty body with its media types, so a 409 declared `@body body: void` was published as
  `contentTypes: ["application/json"]` beside `schema: undefined`, which a consumer reads as a body it
  cannot validate. The same on a request reached the Zod walk and refused the compile with
  `unsupported-type`; it is now no body, and `WireInputs` states no input for it. openapi3 publishes no
  `content` for `void`, and `schema: {}` for `never`, since its body paths test only for `void` while
  it omits a `never` property from every schema; the divergence is in
  [Known limits](docs/reference.md#known-limits).

### Fixed

- **An `@encode`d list parameter is decoded by the rule its schema is built by.** An array encoding
  on a query parameter is a style and the declared list stays; any other `@encode` makes the wire type
  the type it states. The schema followed that, while the split, the element decoder and the path
  expansion each read `@encode` their own way: a comma-delimited header or path list and a
  custom-encoded query list were split into an array and handed to `z.string()`, and a
  pipe-delimited list of numbers was split but never decoded, so all four refused every request. The
  same rule now decides each, so `EmittedRoute.decodedPathParameters` no longer lists such a path
  parameter. A form-exploded query model's property reads its encoding too.
- **Two scalars whose `@encode` name each other are reported** as `encode-cycle`, where the walk that
  followed the chain overflowed the stack and crashed the emitter.

### Added

- **`EmittedRoute.sharedInputKeys`**, and the warning `shared-input-key`: two inputs of one operation
  that a handler would be handed under one key, such as `@header("x")` beside `@query("x")`. The
  handler input spreads the parameter groups into one object, so the later value replaced the earlier,
  and `WireInputs` wrote both as members of one type, which does not compile. The key is now typed and
  validated as both declarations at once, and a server emitter reading the field declines to mount
  the operation. A route built by hand needs the field, empty for almost every operation.
- **`encode-cycle`**, an error, for an `@encode` chain that returns to where it started.

## [0.29.0] - 2026-10-15

Upgrading: [what to check before you take this](docs/guides.md#to-0290).

### Changed, breaking

- **A date-time header with no `@encode` is an RFC 7231 HTTP-date** (#4). That is TypeSpec's wire
  form for one and what `@typespec/openapi3` publishes, `format: http-date`. It was validated as RFC
  3339, so a request sending it as the document describes was refused, and a handler setting it as
  an HTTP-date failed its own response contract. It is `z.string()`, as the explicit
  `@encode(DateTimeKnownEncoding.rfc7231)` already was. The rule is openapi3's: the header's own type
  is the standard `utcDateTime` or `offsetDateTime`. A declared scalar, a list, and `T | null` (an
  `anyOf` at 3.1 and 3.2) stay RFC 3339, as the documents publish them.
- **A scalar extending a constrained scalar is constrained by both.** `scalar ShortWord extends
Word` with `@pattern` on `Word` validated as a bare `z.string()`, accepting every value the
  document refuses: only the decorators of the scalar a property named were read. Each keyword is now
  read from the nearest scalar up the `extends` chain that declares it, which is how openapi3 builds
  the schema - a keyword the derived scalar declares replaces the base's rather than adding to it.
- **`@encode(DateTimeKnownEncoding.rfc3339)` on a date-time keeps its date-time check.** The encoding
  reports `string` as its type, which emitted `z.string()` for the explicit spelling of the default,
  while the document still publishes `format: date-time`.

### Changed

- **Spec text outside ASCII is written as `\uXXXX` escapes**, in every string and regular-expression
  literal the emitter writes. The values are the same at run time. No generated file may carry such a
  character, and every site used a bare `JSON.stringify`; the corpus held none until descriptions
  carried `payload/xml`'s section signs and dashes into `schemas.gen.ts`.
- **A property named `__proto__` is declared with a computed key**, `["__proto__"]`. The plain key
  set the shape's prototype instead: the property was missing from the published JSON Schema, and
  under `seal-object-schemas` every body carrying it was refused as an unrecognised key.

### Fixed

- **A word in a description or a pattern is not a reference.** Which RFC 6570 decoders and imports a
  file needs was decided by tokenising emitted source, string and regex literals included, so a
  parameter documented as naming `uriExpansion` declared the decoder in a service that never called
  it, and the file failed `noUnusedLocals`. Only code is read now.
- **A cycle through a model a request projects compiles.** The structural type and the getter
  annotation named each reference by its bare name, so `NodeCreate`'s `children` was typed `Node[]` -
  the read shape, with a property the request never sends - and the declared validator did not
  satisfy its own annotation (`TS2375`). Nothing in the corpus combines a cycle with visibility.

### Added

- **The validators carry every description the document publishes.** A model's, enum's or named
  union's doc goes on its declaration, a property's or parameter's on the property, outermost, and a
  declared scalar's on each property it types - the property's own doc winning, as OpenAPI 3.1's
  sibling `description` wins over a `$ref`. Nothing carried one before, so a surface publishing JSON
  Schema from these validators - an MCP server's `tools/list` - gave a model calling a tool bare
  patterns and enums, with nothing to say what a field is for, and a client checking that schema
  before it calls refuses what the model guessed wrong. `.describe()` changes nothing a parse
  decides. A differential arm compares every description in the conformance corpus against the
  document, 344 positions, and `test/descriptions` each position by construction. See
  [Descriptions](docs/reference.md#descriptions).
- **`EmittedRoute.decodedPathParameters`**: the path parameters whose validator undoes an RFC 6570
  expansion. A caller holding the value rather than the segment text - a tool call, a service
  binding - validates against `pathSchema.shape[name].out`; through the decoder, `{ param: "a" }` is
  refused for `{.param}`.
- **`literal`, exported beside `objectKey`**, for a value written into emitted code as a literal
  whose source is ASCII.
- **Two warnings for a wire name a Zod validator cannot treat as a key.**
  `optional-prototype-name`: an optional property named after an `Object.prototype` member refuses
  every value that leaves it out, a Zod defect (colinhacks/zod#6666), pinned so its fix is noticed
  (#5). `unenforceable-property-name`: a property named `__proto__` is never validated, because Zod
  skips the key by design (#6).

## [0.28.0] - 2026-10-11

Upgrading: [what to check before you take this](docs/guides.md#to-0280).

### Changed, breaking

- **An optional property is `?: T` in `requests.gen.ts`, and `?: T | undefined` only where it has a
  default.** The contract types now state the validator's input, `z.input`, exactly. A value typed by
  `WireOutputs` could carry `{ note: undefined }`, which `.exactOptional()` refuses, so a handler
  returning it failed to compile against its own result type (`TS2375`) and, passed through a cast or
  a service binding, answered **500 `ResponseContractError`** for a body whose bytes were valid.

  Kept everywhere since `0.19.0` on three reasons, each measured false since `0.24.0` moved the
  validator to `.exactOptional()`:

  - the echo handler `(ctx, input) => ok(input)` needed it, because what arrived carried
    `| undefined`. What arrives is `?: T` now, and the echo compiles;
  - `{ p: undefined }` serialises identically to omitting `p`. A server checks a body before it
    serialises it, and a service binding never serialises it;
  - refusing it costs a producer a conditional spread. That spread infers `{ p?: T }` on TypeScript
    5.9 and 7.0 and assigns to the exact type.

  A defaulted property keeps `| undefined` because `.default(v)` really does accept it and fills `v`.
  `Supplied<>` is gone from `wire-contract.gen.ts`: the two walks are compared with nothing widened.
  The cyclic declarations in `schemas.gen.ts`, written by the same walk, change the same way.

- **`WireInputs[op]` is the input the operation's handler receives, for every operation.** The
  contract walk re-derived each input for itself and always merged the body into the parameters,
  while the server emitters name every body the merge cannot express. So for a union, array, indexed
  model, scalar, enum, optional or optional-multipart body, `WireInputs` described an input no handler
  is given, and a backend typed by it could not be handed the handler's input.
  Both walks now read one placement rule, the one `EmittedRoute.bodyProperty`,
  `optionalBody` and `rawBodyProperty` publish.

  - **Every operation is keyed.** One taking no input is `Record<string, never>`, which is what its
    handler is passed, and one whose only success is a range is included. Both were skipped, so
    `keyof WireInputs` could not enumerate a document's operations.
  - **A binary `bytes` body is a `ByteStream | null`, `ByteStream` a new export**, because the
    server hands it over unread, and `null` where the request carried no body. `ArrayBuffer` made a
    server read the whole body to satisfy a backend typed by it. `ByteStream` is the reader every
    platform stream has, with its optional `cancel`, spelled structurally so a contracts package
    compiled with no DOM or runtime library can name it. A platform `ReadableStream<Uint8Array>` is
    assignable to it under lib.dom, lib.webworker, `@cloudflare/workers-types` and `@types/node`, on
    TypeScript 5.9 and 7.0.
  - **The per-operation aliases are gone.** `CreateUserInput` was declared for `createUser`, and that
    is a name a spec may well give its own body model, so the two collided (`TS2300`) and the
    contracts did not compile. Use `WireInputs["createUser"]`.

- **A model body that sends a key a parameter also has is named, rather than merged.** Merged, the
  body's value replaced the parameter's and nothing reported it: `parameters/spread`'s composite
  request lost its path `name`, and a body carrying the `shelfId` its path already names put the
  book on the shelf the body chose while a check on the path saw the other. The body is now under
  its parameter's name, beside the parameter, as `WireInputs` and the server emitters' inputs state
  it. A read-only property is not in the body sent, so it collides with nothing.

- **`requests.gen.ts` needs TypeScript 5.7 or later where an operation answers bytes.** A binary
  response body is `Uint8Array<ArrayBuffer>` among its alternatives, and typed arrays take a type
  argument from TypeScript 5.7. Nothing in 0.27.0's output needed it.

- **A model named after a helper the emitted files declare is renamed with a trailing `_`**, as a
  reserved word already is: `ByteStream`, `Produced`, `ResponseArm`, `Simplify`, `WireInputs`,
  `WireOutputs` and `WireResults`. A model named `Produced`, `Simplify` or `ResponseArm` was declared twice (`TS2300`),
  and one named `WireInputs`, `WireOutputs` or `WireResults` silently MERGED into the lookup of that
  name, so an import of the model gave the lookup instead. The guard
  reads the names off emitted output rather than off the list it grades.

- **`WireOutputs[op]` is every success body the operation declares, for every operation.** It was
  the lowest success status's body alone: `200 Thing | 201 Other` published `Thing`,
  `200 Thing | 204` published `Thing`, and an operation answering only `204` was absent, while the
  runtime beside it carried every arm. It is now the union of each `2xx`/`3xx` response's body,
  `undefined` for one with no body, and `never` for an operation that declares no success. A binary
  body is `ByteStream | Uint8Array<ArrayBuffer> | ArrayBuffer`, and a stream is `ByteStream`, as the
  server emitters accept them. A model served under a media type that is not JSON, such as
  `application/xml`, is `string`, the text a producer serialised: it was `Produced<Model>`, which no
  server serialises from. Under a media type that is not text either, such as
  `application/octet-stream`, it is bytes, as a binary body is. The model itself is still declared.
- **A model answered under a media type that is neither JSON nor text is served as bytes.** Its
  `ResultMember.serving` is `"binary"` where it was `"unvalidated"`, so a server emitter serves the
  bytes a handler returns rather than a string, which served as UTF-8 cannot carry an
  `application/octet-stream` or `application/x-protobuf` body. `ResultMember.unvalidated` (new) still
  says its schema goes unchecked. Text is the `text/*` types and the XML types, `application/xml`
  and the `+xml` suffix (RFC 2046, RFC 7303); `isTextualMediaType` (new) is the rule.

### Changed

- **Built and graded against TypeSpec 1.17.** The optional `@typespec/streams` and
  `@typespec/versioning` peers admit `^0.87.0`, so a consumer on the current compiler no longer gets
  an unmet peer. The corpus is `@typespec/http-specs` `0.1.0-alpha.44`.

### Fixed

- **`wire-contract.gen.ts` pairs every model a response names, not only request bodies.** A model
  only ever SENT was compared with nothing, so its contract type could drift from the validator the
  server serves it through: measured, a planted drift in a response-only model left every arm green
  under the old pairing and fails the build under this one.
- **`redos-prone-pattern` gives every pattern the same verdict on every machine.** Its analysis was
  bounded by 500 ms of wall-clock time and running out read as "not proven safe", so under load an
  ordinary pattern was sometimes reported, which with `warn-as-error` is a flaky build. The bound is
  now `redos-detector`'s step count.
- **A media type declared with a parameter or in capitals is compared by its essence.**
  `@header contentType: "application/json; charset=utf-8"` declares JSON, and `Application/JSON` is
  `application/json`. The `Content-Type` validator reduced a request's value to its essence and
  compared that with the declared text, so it refused every request to such an operation. It now
  compares essences and hands the handler the value as declared, which is what its input type says.
  The JSON, parseable and range checks compare essences too, so such a body is placed and validated
  as JSON, not handed over as text.
- **A body declared only under media types nothing can parse into it is handed over raw.** A
  model under `application/xml`, or a `string | int32` under its default `text/plain`, has no reader
  this emitter can derive. The server checked the request's headers and called the handler with the
  body never read, while `typespec-hono`'s `unvalidatable-media-type` warning said such requests
  were refused. It is now a raw body, `rawBodyProperty`, and `EmittedRoute.rawBodyUnvalidated` (new)
  says its schema goes unchecked. Under a textual media type it is the text that arrived
  (`rawBodyBinary: false`, `{ body: string }` in `WireInputs`), which is what the response side
  already asks of a handler serving a model as XML. Under any other, such as
  `application/octet-stream`, it is the unread stream (`ByteStream | null`): decoded as text, every
  byte that is not valid UTF-8 became U+FFFD. A string body is unchanged: it is text, and its
  schema still checks it.
- **A delimited query parameter's contract type is the list, as its handler receives it.**
  `@query @encode(ArrayEncoding.pipeDelimited) colors: string[]` was typed `colors: string` in
  `WireInputs`, while the validator splits it back into the declared `string[]`. The contract walk
  read `@encode` directly and missed the exception the Zod walk already made for a parameter's array
  style. Both now ask `encodedTypeOf`.
- **A form-exploded query record whose key is the parameter's own name is gathered.**
  `{ param: 0 }` for `@query(#{ explode: true }) param: Record<int32>` arrives as `?param=0`. The
  gatherer took any `param` key as a query already gathered and left it in place, so the record
  schema refused the string with a 400. Only an object under the name is now taken as gathered, since
  a query value from the wire is a string or a list of them.
- **Each `@service` gets its own contract types.** `contracts-output-dir` was shared by every service
  in a spec, so the second service's `requests.gen.ts` replaced the first's, and a whole surface lost
  its contracts with no diagnostic. Where two or more services write to it, each now writes to
  `<dir>/<ServiceName>`, and each service's `wire-contract.gen.ts` compiles beside its own. A service
  that is the only one writing there, the rest naming their own directory, writes where it did.

- **An `Http.File` body reaches the route, as an upload and as a download.** `requestBodyOf` and
  the response walk read only `bodyKind === "single"`, so a file body was dropped silently: every
  upload in the corpus's `type/file` handed its handler `{}`, and every download was served with no
  body, from a compile that reported success. A file is now what `@typespec/openapi3` publishes it
  as, a media type and nothing to parse:
  - **An upload** is a raw body under its parameter's name, with the media type the request declared
    as `"Content-Type"`, exactly as a declared `@header contentType` would be.
  - **A download** is a binary arm.

  Both are bytes whatever the media type, which `@typespec/http` permits for a textual file, so
  `EmittedRoute.rawBodyBinary` (new) says so: a file declared `application/json` cannot be told from
  a JSON body by its media type.

  **Found by a new divergence kind, `dropped-body`:** wherever the document publishes request or
  response content and the route record carries none. It fires on exactly those eight positions
  before this change and on none after. The baseline's `unreadableResponseBodies: 4`, documented as
  "a stream or a union", had been counting the four downloads all along; it is 0 now and the limit is
  no longer listed.

- **A response header's published type is encode-aware, as its schema already was.**
  `@header("Retry-After") @encode(DurationKnownEncoding.seconds, int32) retryAfter: duration` published
  `EmittedResponseHeader.type` as `string` while its schema checks `z.int32()` and the document says
  `integer`. A server emitter typing a handler's result from it demanded a string that its own
  header check then refused, so the arm could not be returned without a cast. The type now comes
  from `propertyTypeToTs`, which request parameters already used.

### Added

- **`WireResults[op]`: every operation's result, framework-free.** One member per declared
  response and media type, each pairing a status with its own body and headers - the union
  `typespec-hono`'s handlers return, stated with nothing to import. A `4XX` or `default` response is
  the codes it stands for, written out, so a client can narrow on the status. A backend typed
  `(input: WireInputs[K]) => Promise<WireResults[K]>` can say whether it answered `200` or `201`
  with the same model, which a body type cannot.

- **`mediaTypeEssenceOf`**: a media type's `type/subtype`, lowercased and without parameters, for
  an emitter comparing declared media types the way this package does.

- **`resultMembersOf`, `statusCodesOf`, `mediaTypeTypeOf`, `isJsonMediaType`, `isMediaRange`,
  `isTextualMediaType`, `STATUS_CODES` and `CONTENTLESS_STATUS_CODES`, with the types `ResultMember`,
  `ResponseFacts` and `BodyServing`**: what a result is made of (one member per declared response
  and media type, its serving kind, whether its schema goes unchecked, and the status codes each
  answers with), exported for the server emitters. Both `typespec-hono` and `typespec-http-mcp` held
  a copy of these rules and of the status table.
- **`EmittedRoute.rawBodyUnvalidated`**: the raw body is declared with a schema nothing checks it
  against, so a server emitter can say so without inferring it from the media types.

- **`EmittedService.operations`: the `HttpOperation` each route was collected from, keyed by
  operation id.** Verb and path do not identify an operation, because `@sharedRoute` gives every
  member the same ones, and both server emitters looked operations up by them: a diagnostic about
  one member pointed at another, and the tool emitter read one member's doc comment and tags for
  all of them.

- **`RouteSchemaNames.selectedAccept`**: on a route several operations share, the `accept` header
  `header` leaves out and the one literal that reaches this operation, which its handler receives.
  `typespec-hono` derived it for itself, and `typespec-http-mcp` did not derive it at all, so a tool
  on a negotiated route was not given the `accept` the server's handler is given.

### Fixed (graded, not shipped)

- **The portability harness proves what it claimed.** It set `types: []` and no `lib`, and
  TypeScript's default libraries include the DOM, so a `File` in emitted output compiled. It now
  compiles under `lib: ["es2023"]`.
- **The conformance suite reads `additionalProperties` as well as `unevaluatedProperties`** for
  openness, as two of its three sites already did. `@typespec/openapi3` 1.17 publishes a leaf
  dictionary under the first (microsoft/typespec#11954), and the third site reported every one as a
  divergence.

## [0.27.0] - 2026-09-20

Upgrading: [what to check before you take this](docs/guides.md#to-0270).

A minor carrying thirteen things, three of them breaking: **a pattern that can be made to backtrack is
named**, **cookie parameters reach the server at all**, **a response header keeps its Zod
expression**, **a declared integer width is enforced**, **a published pattern is compiled the way its
readers compile it**, and **a declared media range admits the types inside it**.

**A pattern that can be made to backtrack is named.** `@pattern` was passed through to
`z.string().regex()` with no analysis, so a spec author could write an ordinary-looking rule whose
cost is exponential in the length of the input, and nothing said so. Every emitted validator runs it
on every request, before any handler, against input a caller chooses.

The package now ships a TypeSpec linter, and its `redos-prone-pattern` rule analyses each pattern
with [`redos-detector`](https://github.com/tjenkinson/redos-detector) and flags one it cannot prove
safe. The regex itself is unchanged: `@typespec/openapi3` publishes it verbatim,
and rewriting it here would enforce something the document does not state. The remedy belongs in the
spec, and the diagnostic names both forms it can take.

**It is a linter rule, so it is off until a project enables it**, with
`linter: { extends: ["typespec-http-zod/recommended"] }` in `tspconfig.yaml`, and the documentation
says to. TypeSpec draws the line in its own docs: a diagnostic says the program is not valid for the
library, a linter is for a program that "could be correct, but there might be room for improvements".
The spec is valid and the emitted regex is the published one, so what is wrong is a cost no artefact
states. Raised instead as an automatic warning, the same check would fail the build of every project
that sets `warn-as-error: true` whether or not it asked for the advice. A pattern that has been looked
at and kept is acknowledged with `#suppress` where it is declared.

The analysis is conservative: it proves that one input can match a pattern two ways, which is
necessary for the failure but not sufficient for it to be reachable.

The rule and `routeTemplateOf` are exported, so `typespec-hono` can offer the rule through its own
ruleset and compute the route set a router is given the same way this package does.

`redos-detector` is this package's first runtime dependency. MIT, one transitive chain, pure
JavaScript, no platform-gated optional dependencies.

**Cookie parameters reach the server at all.** Two filters named three of `@typespec/http`'s four
parameter locations and excluded `cookie` by omission rather than by a `never` check, so nothing
objected. A `@cookie` reached no schema and no handler input while `@typespec/openapi3` published it
as required, and the compile was clean. It now emits a cookie group like any other location.

**Breaking: a response header keeps its Zod expression.** Response headers went through the
TypeScript projection only, and the `ModelProperty` was in hand and discarded. Each status carrying
headers now gets a `<OperationId>Response<Status>Headers` schema, and `EmittedResponseHeader` gains
`schema` beside `type`. Both are optional, so a wrapping emitter that does not read them still
builds, but one that generates from the arm list will see the new declaration.

**Breaking: a declared integer width is enforced.** All ten integer scalars emitted
`z.number().int()`, which is an integer within the safe range and nothing more, so a declared `uint8`
accepted `-5` and `100000` and a declared `int32` accepted `3000000000`. Each width now carries its
own bounds, through Zod 4's named formats where they exist (`z.int32()`, `z.uint32()`) and explicit
bounds where they do not.

A caller sending a value outside a width the document declares now gets a 400 where it used to get a 200. `int64` and `uint64` keep the safe-integer ceiling, because `JSON.parse` has already lost a
value above 2^53 before any validator runs; what changes for `uint64` is that it stops accepting
negatives.

The differential oracle could not see any of this, and now can. JSON Schema 2020-12 treats `format`
as an annotation, so Ajv on the published document agreed with the permissive validator while both
were wrong. The comparison translates a declared width into the bounds that express it, on both
sides, so a validator that FORGETS a width's bounds diverges where discarding them would have hidden
it.

**Breaking: a published pattern is compiled the way its readers compile it.** A JSON Schema
`pattern` is an ECMA-262 expression and a reader applies the Unicode flag; Ajv does by default. The
emitter wrote a bare `/.../`, which makes `\p{L}` an identity escape for the letter `p` rather than a
Unicode property, so the server ran a different expression from the one the spec author wrote and
the one the document publishes. Measured against Ajv, every verdict was inverted: `"abc"` valid in
the document and refused here, the literal text `"p{L}"` the reverse.

The flag is now carried whenever the pattern compiles under it. It cannot be carried
unconditionally - it makes a redundant `\-`, a lone `]` or `{`, and an escape like `\a` into errors,
and 5 of 15 realistic patterns tested fail on it. Those keep the bare form and are named by the new
`non-unicode-pattern` warning, because a reader of the document cannot compile them either: Ajv
throws rather than evaluating them, so the server was enforcing a rule nothing reading its own
document could.

A caller sending a value that only matched under the old, wrong reading of such a pattern now gets a
400, and one sending a value the document always accepted stops getting one.

**A reference cycle with no declaration on it is named rather than crashed.** A recursive model is
fine: it earns a declaration, and the back edge becomes a getter or a `z.lazy()` naming it. A cycle
closing through a type this emitter INLINES has no such name, and a template instantiation is the
reachable case. `model Box<T> { next?: Box<T> }` used as `Box<string>` walked into itself until the
stack ran out, and the compiler reported it as "Emitter crashed! This is a bug." It now raises
`inline-cycle`, an error, matching the `inline-cycle` `@typespec/openapi3` raises on the same spec.

**`@friendlyName` on a template instantiation now makes it a declaration.** That is the remedy both
emitters name for the cycle above, and it did nothing here. `@typespec/openapi3` stops inlining an
instantiation that has been named - the first thing its `shouldInline` does is check
`getFriendlyName` - and publishes a component for it. This emitter went on inlining, so the two
artefacts disagreed about what has a name. Measured on `@friendlyName("{name}Box", T)`: openapi3
publishes a component `stringBox` and refers to it with `$ref`, and this now declares
`stringBoxSchema` beside it.

**Non-ASCII characters no longer reach generated files.** `src/api.ts` spelled three non-ASCII
characters as escapes inside docblock text written verbatim into `wire-contract.gen.ts`. The
portability arm read source, where the escape is plain ASCII, so it passed while every generated
file received the characters. It now checks emitted output as well.

**Two types with one name are refused rather than emitted into a module that cannot parse.** A
declaration is keyed on `(visibility, name, identity)`, so `Alpha.Thing` and `Beta.Thing` were two
entries that both emitted `export const thingSchema`. The document published them as separate
components, `tsc` answered `TS2451: Cannot redeclare block-scoped variable`, and `tsp compile`
reported success. `duplicate-declaration` already existed and already said the right thing, but only
the contract-type walk raised it, so `schemas.gen.ts` - the module every consumer imports - was not
covered. Both walks raise it now.

**A declared media range admits the types inside it.** A `@header contentType` declaring a range -
`"text/*"`, or the full wildcard `"*/*"` - emitted a literal, so the only request that satisfied it
was one sending the range itself as its `Content-Type`, which no client does. Measured at the wire
on a route declaring the full wildcard: `application/json`, `text/plain` and `image/png` all
answered 400, and the literal `*/*` was the one value accepted.

A subtype range now emits a template literal, which is the Zod counterpart of the TypeScript type
the contract already uses for one. The full wildcard admits every media type, because that is the
whole of what it means.

**A `@pattern` containing a forward slash emits a module that parses.** The emitted regex literal
escaped every slash unconditionally, so a pattern that already spelled one as an escape had its
backslash doubled: `^\/api\/v[0-9]+$` became a literal ending at the third slash, with the rest
read as flags. `tsp compile` reported success and the generated module then failed to parse at all,
which a path regex makes an ordinary thing to hit.

**Two faults in one `@pattern` are both reported.** `redos-prone-pattern` and `non-unicode-pattern`
shared one record of what they had already said about a declaration, so whichever ran first silenced
the other and the author learned of the second fault only after fixing the first and compiling
again.

**A numeric bound on a value `@encode(string)` carries as text is dropped, and named.** The bound is
on the number, while the emitted expression is a string, so `@minValue(10)` landed as a length check
that `"42"` satisfied and `"9"` did not. The exclusive form was worse: it emitted a call that does
not exist on a string schema, so the module threw on import. The bound is now dropped rather than
mistranslated, and `unenforceable-encoded-bound` names it and points at `@pattern`. A value the old
length check refused is now accepted.

## [0.26.0] - 2026-09-16

A minor carrying four things, three of them breaking: **one complete response record per status**,
**a route's RFC 6570 form and the values it decodes**, **`authentication` in place of `noAuth`**, and
**a request body that is not a model is named rather than merged** - which had been dropping such a
body silently.

**Breaking: one complete response record per status.** A server emitter can now type a handler's
return as the union of every response the document declares, because each arm carries its own body,
media types and headers, whatever kind of status it is.

`EmittedRoute` carried responses in five projections, and each had a hole the others did not:

- **a second success status carried the first status's body.** `op two(): Opened | Queued`, with
  `Queued` declaring a different model at 202, emitted `{ status: 202, schema: openedSchema }`, and the
  202 body's component was never declared at all;
- **a failure arm carried no headers and no media types.** A `429` declaring `Retry-After`, or a
  `4XX` range, published both in the document and neither in its arm;
- **a failure's inline body was an expression inside the arm list**, so nothing outside it could name
  the schema;
- **an operation whose only success was a `2XX` range was dropped** without a diagnostic.

Replaced by `EmittedRoute.responses`, one `EmittedResponse` per status key in OpenAPI's precedence
order, built in one pass over `@typespec/http`'s resolution. `RouteSchemaNames.arms` gives an
identifier for every body, failures included. Each record also says whether its body is raw binary, a
stream, or a string (`textual`), which is what a server needs to serve a non-JSON body: a string
under `text/plain` is the text, a model under `application/xml` is not.

**Removed:** `EmittedRoute.statusCode`, `statusCodes`, `responseSchema`, `errorArms`,
`responseHeaders`, `responseMediaTypes`, `statusBy`, `statusSelector`, `alternateResponseSchema`;
`RouteSchemaNames.response` and `alternateResponse`; `ResponseArm.when`; and the `property` of a
response header, which is now `{ name, optional }` by wire name. A handler names the status it
answers with, so no arm names a TypeSpec property to read the choice from.

**Emitted output changes:** every arm carries `contentTypes` and `headers` where the document names
them; a success body declared inline is named `<operationId>Response<status>` rather than
`<operationId>Response`; arms are ordered exact codes ascending, then ranges, then `default`.

**`runtime-module` and `EmitHttpZodOptions.defaultRuntimeModule` are removed**, and `emitHttpZod`
takes the emit context alone. `schemas.gen.ts` declares the `ResponseArm` shape it annotates its arm
lists with instead of importing it, so the emitted output depends on no runtime. That line was the one
place two emitters sharing an output directory could disagree about `schemas.gen.ts`, whose writer is
decided by the order of `emit:`, and it was the only thing the option decided. `typespec-http-zod/runtime`
still exports `ResponseArm` and `armFor` for an application reading the arms; a compile arm holds the
declared shape assignable to it.

**Graded:** `test/responses/complete.test.ts`, eight arms, each red before the change. The
conformance differential now compares every arm's media types and headers with the document across
the corpus. Controls: dropping failure-arm media types, or every header, turns it red. The corpus
declares no header on a failure arm, so that case is held by the fixture suite, where dropping
failure-arm headers turns three arms red.

### Fixed

- **A request body that is not a MODEL is named rather than merged into the parameters.** `@body body:
string` emitted a handler input of `Record<string, never>` and a call site of `{}`: the server
  validated the body and handed the handler nothing, from a compile that reported success. An enum or
  union body failed loudly instead (`TS2698`), which is what four conformance scenarios had been
  pinned on. A `bytes` body is unaffected: `rawBodyProperty` already names it.
- **`EmittedRoute.requestTextual` is new**, so a server can read a body the document says IS text.
  `text/plain` has no JSON, form or multipart reader, and a server emitter had no way to tell a string
  body from a model framed as text - so it emitted no body middleware and the body was never read.
- **A recursive model's schema no longer infers `unknown` in anything that WRAPS it.** The getter that
  defers a back edge carried no return type, so `z.infer` of `z.record(z.string(), innerModelSchema)`
  gave `children?: unknown` and `.parse()` on it returned `unknown` outright. The getter is annotated
  now, which leaves `.shape` and `.extend` intact - annotating the declaration would not have. A
  recursive property carrying a DEFAULT is the one shape left unannotated, and says so in the source.
- **A multipart part that means a number or a boolean now accepts the text a form carries.** A part's
  validator was the document's schema alone, so `HttpPart<float64>` was `z.number()` and
  `c.req.parseBody()`'s `"0.5"` was refused. Measured by request against a server generated from
  `@typespec/http-specs` `payload/multipart/non-string-float`: a 400 for the exact request the scenario
  documents. A part is now decoded by the rule path, query and header values already use, so text that
  is not a well-formed number still fails against the document's schema. `test/multipart/` holds the
  arm, proven red first.
- **A multipart part whose media type is JSON now accepts the JSON text a form carries.** A client
  sends `HttpPart<Address>` or `HttpPart<int32[]>` as text with `Content-Type: application/json` and
  no filename, so `c.req.parseBody()` hands over a string and the schema refused it with
  `expected object, received string`. Measured on the exact bytes the Postman CLI sends, and by request against
  a server generated from the same spec: a 400. Such a part is now JSON-parsed before the document's
  schema applies, and text that is not JSON is refused as such, including for a JSON part whose schema
  admits a string. `test/multipart/` holds the arms, proven red first. A part sent as a file (with a
  filename) still arrives as a `File`, which a synchronous validator cannot read, and is refused.
- **`EmittedRoute.security` keeps an anonymous alternative, as the document publishes it.**
  `@useAuth(NoAuth | BearerAuth)` is `security: [{}, { "BearerAuth": [] }]` in the document
  `@typespec/openapi3` writes, and this published `[{ "BearerAuth": [] }]`: a contract refusing the
  anonymous caller the document accepts. `@useAuth(NoAuth)` is now `[{}]`. `test/security/` compares
  every operation's `security` with openapi3's own, red first. **A reader that assumes every
  requirement names a scheme meets a new shape**; one applying the documented rule (any one
  requirement, every scheme in it) admits `{}` unchanged.
- **A path value in an RFC 6570 form, and a form-exploded query record or model, are decoded before
  they are validated.** A path list was never split and a record never paired, and `{?param*}` over an
  object has no `param` key at all, so a server built on this library refused or never routed 34 of
  the requests `@typespec/http-specs` declares conformant. See `EmittedRoute.pathSegments` below.
  `test/expansion/` holds the arms, red first, with the values and URIs the `routes` scenario documents.

### Added

- **`EmittedRoute.authentication`: `"none" | "optional" | "required"`**, whether an operation needs a
  caller. `noAuth` could not tell `@useAuth(NoAuth)` from `NoAuth | BearerAuth`, so a server passing it
  on never saw a caller who presented a valid token on an optional route. **Breaking: `noAuth` is
  removed**; read `authentication !== "required"` where it meant "a caller may be absent".
- **`RouteSchemaNames.queryFields` and `EmittedRoute.queryFieldsSchema`**, the query object with a
  `.shape`. Where a form-exploded record or model is gathered, `<id>Query` is
  `z.preprocess(gather, <id>QueryFields)` and has no `.shape`, so a consumer spreading request fields
  reads `queryFields`; everywhere else the two are the same identifier.
- **`EmittedRoute.pathSegments` and `literalQuery`**, the route as a server has to mount it, read from
  `uriTemplate`. `path` strips every operator, so a router mounted from it could not match
  `array{.param*}`, `array{;param}`, `optional{/name}` or a literal query string.

## [0.25.1] - 2026-09-13

A patch: **the `@typespec/streams` and `@typespec/versioning` peers now admit `0.86.0`.** Nothing
emitted changes and no published type changes, which is what makes it a patch.

On a `0.x` version a caret pins the MINOR, so `^0.85.0` excluded `0.86.0` outright, and a project on
`0.86.0` was installing against a range this package said it did not support.

**Verified rather than asserted:** the whole suite runs against `@typespec/compiler@1.16.0`,
`@typespec/http@1.16.0` and `@typespec/{rest,versioning,streams,sse,events,xml}@0.86.0`, every gate
green by exit code. The `@typespec/compiler`, `http` and `openapi` peers are unchanged at
`^1.15.0`, which already admits `1.16.0` because a caret on a `1.x` version does not pin the minor.

### Two things deliberately NOT in this release

Both are real, both are measured, and both are larger than a patch.

- **zod `4.6.2` breaks `compile-schemas`.** A validator that merely REACHES a cycle -- not the
  deferred declaration itself, which this emitter already skips -- throws
  `Cannot read properties of undefined (reading '_zod')` inside zod's own `z.compile()` on the first
  parse. That is the exact failure `test/compile/compile.test.ts` already documents for a `z.lazy()`
  declaration; on `4.6.2` the rule "skip the deferred one" is no longer sufficient. The `zod` peer
  still reads `^4.5.0`, which over-claims for anyone who turns the option on. Dev dependency held at
  `4.5.2` until the emitter skips every cycle-reaching declaration.
- **`@typespec/http-specs@0.1.0-alpha.43` surfaces four disagreements**, one of which is a genuine
  `response-body` divergence between the validator and the document rather than a count that moved.
  Corpus held at `alpha.41` until each is understood; absorbing them by adjusting floors would be
  exactly the narrowing this suite exists to refuse.

## [0.25.0] - 2026-09-12

A minor carrying five things: **`EmittedRoute` now publishes `security`**, **two reserved words
that made emitted output unparseable are now mangled**, **`jsDocComment` is exported so a doc string
can be put into emitted source safely**, **`truncated-doc-comment` warns when the compiler has cut a
doc comment short**, and **an optional multipart body is now named rather than merged**, which is
what made its emitted server fail to compile.

**Two of the four are one lesson.** A model named `as` and a summary containing `*/` both cost a
whole emitted file rather than one line, and both are spec-authored text reaching generated source
unchecked. `objectKey` has answered that question for a property NAME since this package existed;
`jsDocComment` now answers it for a doc STRING.

### `@visibility` published a contract type the validator beside it refuses

**The defect, and it was not only a compile failure.** `SchemaRegistry` emits a visibility-projected
schema per position - `ThingCreate` for a POST body, exactly as `@typespec/openapi3` names the
component. `TypeRegistry` emitted ONE declaration per model name carrying the canonical property set
and used it everywhere. So a create body's contract type listed read-only properties, and the
validator beside it is a `strictObject`: a caller who satisfied the published type sent a property the
validator rejects as an unknown key and got a 400.

**It failed loudly only where `contracts-package` was set.** The assertion that
catches it lives in `wire-contract.gen.ts`, which is emitted only when `contracts-package` is also
set. Without it nothing compares the two artefacts and the wrong contract ships in silence. Measured
on a two-property model: validator `z.strictObject({ createProp })`, contract `{ id, createProp }`.

**Three things were wrong and all three are fixed.**

- **`TypeRegistry` is keyed on `(type, visibility)`**, as `SchemaRegistry` already was. Both now go
  through one `visibilityFor` and one `nameAt` rather than two copies of the rule - they pair BY NAME
  in the emitted assertion, so a rule paraphrased in one walk compares the wrong two things.

- **The type walk filters metadata.** `metadataInfo.isPayloadProperty` decides whether a property is
  in the body at this position; `modelToZod` has asked since it was written and `modelToTs` never did,
  which is why a `@query` and an `@invisible` property were in that contract type at all. Applied
  after the dictionary check, which must keep reading the unfiltered list.

- **The type walk asks whether a property is optional AT THIS POSITION.** A PATCH body's properties
  are optional whether or not the spec marked them so. This walk read `property.optional` alone, so an
  update contract demanded every field while its validator accepted any subset.

**`collectRequestTypes` now walks at the operation's request visibility** and `collectResponseTypes`
is pinned to `Read` explicitly. Without the first, the contract walk ran at the default and the whole
fix did nothing.

**One hazard found while doing it, worth recording.** `metadataInfo` is a module singleton created
inside `withVisibility` and restored on exit, so outside a scope it is `undefined`. The new predicate
calls created one lazily outside any scope and left it set, leaking one program's metadata into the
next compile - which showed up as the emitted validator disagreeing with the document on a scenario
neither change touched. Running both contract walks inside a scope is what removes it.

**Breaking, and stated as such.** A model used only as a non-`Read` request body now exports
`ThingCreate` and no bare `Thing`. That is what `@typespec/openapi3` publishes for the same spec, and
what `schemas.gen.ts` already emitted, so this is the TypeScript side converging on the two artefacts
beside it rather than a new convention. `WireInputs` resolves either way; a direct
`import type { Thing }` on a spec using `@visibility` does not.

Control: neuter the keying in `TypeRegistry` alone and `type/model/visibility` reddens; restore and it
passes. The corpus baseline that named it is now empty, and it is read in both directions, so the fix
could not have been left half-done.

### The conformance corpus's emitted output is compiled now, and it was never compiling

`wire-contract.gen.ts` is the only thing that catches this emitter disagreeing with ITSELF: it pairs
what the validator accepts against the framework-free contract type, by name. It was written for
every corpus scenario and compiled for none.

**Measured the first time anything ran `tsc` over it: 41 of the 41 scenarios carrying a wire contract
failed.** Every one of them for the same harness reason - `contracts-package` pointed at
`vocabularies.gen.js`, which exports `SPEC_VOCABULARIES` and nothing else, so every model name was a
`TS2694`. That trap is documented word for word in `test/support/compile-fixture.ts`, which avoids it
with a barrel; the corpus harness walked into it, and nothing said so because nothing compiled the
output. Both harnesses now call one `writeContractsBarrel`.

With the barrel in place the count fell from 41 to 3, and the three were real:

- **A vocabulary alias was emitted without `export`.** The comment justifying that said the
  vocabularies artefact "already exports these names as runtime tuples, and exporting both collides
  on every one" - true of a shape this emitter stopped producing, since `vocabularies.gen.ts` has
  exactly one top-level export and the enum names are keys inside it. Nothing collided, and a barrel
  cannot re-export a declaration that is not exported, so `wire-contract.gen.ts` did not compile for
  any spec with an enum request body.

- **An empty model compared unequal to itself.** `z.strictObject({})` infers `Record<string, never>`
  under Zod 4 while this walk emits `{}`. `Declared<>` now maps an indexer whose VALUE type is `never`
  to `{}`, because such an indexer admits no property and is an empty object rather than a dictionary.
  It cannot equate a real dictionary with an empty object: one whose values are `never` accepts
  nothing either.

- **`@visibility` is still open, and it is baselined with its reason.** `TypeRegistry` emits one
  declaration per model name carrying the canonical property set; `SchemaRegistry` emits a
  visibility-projected schema per position. So `type/model/visibility`'s Read schema declares
  `readProp` alone while the contract type declares all six. Fixing it means giving `TypeRegistry`
  the keying and suffixes `SchemaRegistry` already has, which RENAMES published contract types for
  any spec using `@visibility` - a breaking change that wants deciding rather than slipping in.

`test/conformance/typecheck.test.ts` holds it, with floors so it cannot pass having compiled nothing,
a ceiling on how many scenarios the emitter may refuse, and the baseline read in both directions so a
fix that leaves its entry behind fails too. Control: restore the old `contracts-package` and the
clean count falls from 55 to 27.

### `truncated-doc-comment`, a warning, because the compiler drops text and says nothing

An unescaped `@` in a doc comment begins a doc tag, and everything from there to the end of the
comment leaves the description. Measured through the compiler's own parser at `1.15.0`:
`parseDocContent` breaks its loop on `Token.At` outside a code fence, `parseDocTag` keeps the
remainder as an unknown tag, and `getDoc` never reads it. Nothing in that path raises a diagnostic.

**It is not only `{@link}`.** `support@example.com` in prose truncates at `support`, and
"use @maxLength to bound it" truncates at "use", with no brace anywhere to notice.

**The check reads the node, because the string cannot answer.** By the time `getDoc` returns the `@`
is gone, so warning when the doc string about to be emitted contains `{@` matches nothing, and a
guard that fails when a description ends at a brace passes the `@maxLength` case. A tag outside
`param`, `template`, `prop`, `returns`, `return` and `errors` is an unknown tag, which is exact rather
than heuristic. Gated on `getDocData().source` being the
comment, so an `@doc(...)` decorator beside it is not a false positive.

**A warning, for the reason `default-on-required-property` is one.** `@typespec/openapi3` emits the
same spec happily, so refusing it would make one spec representable by one emitter and not the other;
an error would also cost the whole document over one comment.

**It finds one in the conformance corpus, which is not this package's.** `payload/xml` in
`@typespec/http-specs` documents a model with "has @Xml.name. The property name takes precedence.",
and the published 3.1 document carries `S2.2 - Contains a property whose type has`. The rule the model
exists to state is not in the contract.

That is also why the differential's zero-emitter-warnings arm partitions this code out **by proof
rather than by name**: `@typespec/openapi3` derives descriptions from the same `getDoc`, so it
publishes the identical cut text and there is no divergence to measure. `test/doccomment/` compiles a
fixture through `@typespec/openapi3` and requires exactly that, including that the four spellings
which survive do survive, so the exclusion is earned rather than asserted.

**Not filed upstream, and the chronology says why.** `microsoft/typespec#3374` reported this exactly,
naming both `{@link}` and email addresses, and was closed 2024-05-20 as a duplicate of `#1358`, which
is open on the Backlog and untouched since 2022-12-08. `#3375` then added the `\@` escape
deliberately. The truncation is intended and the remedy this message names is upstream's own.

### `jsDocComment`, because a doc string was interpolated into emitted source raw

Both server emitters built on this package render an operation's summary as a JSDoc comment on the
generated `Operations` method, and both built that comment by interpolation with no escaping. A
summary containing a comment terminator therefore closed the comment early and the rest became code.
Measured on the emitted shape: `TS1131`, `TS1434`, `TS1161`.

`/** ... */` doc comments cannot carry that text, because they would terminate themselves, so the
reachable vector is `@summary("a */ b")` or `@doc("a */ b")`, which are ordinary string literals.

**The bar set for it is idiomatic output, not merely parseable output.** A terminator is escaped as
`*\/`, the spelling TypeScript itself uses, so the author's sentence survives intact rather than
being truncated or mangled by a problem they cannot see from their spec. A multi-line description is
rendered as a real multi-line block with aligned continuation lines, because a one-line form with
newlines inside it is something no formatter would produce and no reviewer would write.

Exported for the same reason `objectKey` is, and its docblock says so: there were two sites and only
one of them knew. The rule is shared; the ORACLE is duplicated on purpose, so `typespec-hono` and
`typespec-http-mcp` each grade what they produce.

### An optional `@multipartBody` emitted a server that did not compile

`@multipartBody body?: Parts` published `requestBody.required: false` and merged the parts into the
handler's input anyway, so the generated call site spread a value the validator types as
`Parts | undefined` into a position requiring every part. `TS2345`, inside `app.gen.ts` itself.

**The mechanism is worth stating, because it is not a union.** Spreading `T | undefined` makes every
property OPTIONAL rather than producing two constituents, so `{ file?: ...; pages?: ... }` was passed
where `{ file: ...; pages: ... }` was required. That is exactly the failure `EmittedRoute.optionalBody`
already predicted in prose: a merge has no way to say "these properties are here only sometimes"
without making every one of them optional, which is a weaker and different claim about the body that
IS sent.

**So the rule is not new; it had never reached this body kind.** `0.20.0` published `optionalBody` and
named an optional body for exactly this reason, but the name was decided behind
`requestType?.kind === "Model"`, and `requestBodyOf` resolves a type only for `bodyKind === "single"`.
`requestType` is therefore `undefined` for every multipart operation, and the disjunct was unreachable
however the document declared it. This is the third hole that `"single"` gate has produced, after
`multipartSchemaOf` and `multipartTsOf`; both are recorded in `api.ts`.

**A REQUIRED multipart body is deliberately unchanged and still merged.** The indexed reason does not
apply to a parts model, so it flattens as safely as a required single body, and
`typespec-hono/test/filepart/` compiles a handler reading `input.file` directly. Widening this to
"multipart is always named" would have rewritten that directory for no defect. Both halves are held
by one arm, and the control is the guard deleted: the optional arm reds, the required-multipart and
optional-single-body arms stay green.

Measured zero impact elsewhere. Every `@multipartBody` in `@typespec/http-specs` is required, which
is why the conformance corpus never saw this. `typespec-http-mcp` refuses a multipart operation as
`binary-tool-input` before it reads `bodyProperty` at all, so no tool changes.

### `as` and `yield` produced a file that did not parse

A model named `as` emitted `export type as = ...` (`TS1005: '{' expected`) and one named `yield`
emitted `export type yield = ...` (`TS1214: 'yield' is a reserved word in strict mode`). Both are
also emitted as `export interface`, and `yield` is refused there too. The parser gives up after the
first, so a single such model cost the whole file, not one declaration.

Both are contextual keywords, which is why they were outside `RESERVED_DECLARATION_NAMES`: the set's
own docblock recorded that contextual keywords had been measured as legal and named `yield` among
them. Re-measured against tsc 7.0.2, one invocation per word over 56 candidates: **39 are refused
and 39 are now listed**, with none over-broad.

**The guard that was supposed to catch this could not.** `test/reference/specialwords.tsp` declared
`await`, `break` and `for` -- three words the set already knew -- so it graded the list against
itself and was silent about every word the list did not contain. It is now joined by a spec
GENERATED from `@typespec/http-specs`, one model per word the corpus declares, read off disk rather
than typed here. Proven by deleting `class` from the set: the generated arm goes red and the
hand-written fixture stays green, which is the difference stated as a test result.

### `EmittedRoute` now publishes `security`, the requirements the document actually states

Additive; nothing emitted changes and no existing field changes meaning.

### What was wrong with publishing only `scopes` and `noAuth`

Both were lossy projections of one fact, each with its own read of
`getAuthenticationForOperation`. A flat scope union cannot say WHICH scheme demanded what, so
`@useAuth(BearerAuth)` -- which reaches OpenAPI as `security: [{ "BearerAuth": [] }]` -- arrived as
an empty scope list, indistinguishable from an operation declaring no authentication at all.

The consequence was not hypothetical. A server emitter that wanted to apply the gate the document
publishes had to call `getAuthenticationForOperation` a third time and rebuild the requirements
itself, and **two of them did, in two hand-written copies of one rule** -- neither of which anything
compared against the other. One of the two had already shipped a defect of exactly this shape: a
gate emitted only where a scheme carried scopes, so bearer, api-key and basic -- the common case --
carried no scheme at all.

### What changed

`authenticationFor` reads the program **once** per operation and returns all three facts.
`EmittedRoute.security` is the complete one; `scopes` and `noAuth` are unchanged in meaning and are
now derived from that single read rather than from two more.

`scopes` is a published field, so the change to how it is derived is guarded rather than asserted:
`test/security/security.test.ts` recomputes it **the old way, written out literally rather than
imported**, and requires the two to agree across every authentication scenario the corpus declares --
api-key, oauth2, union, noauth/union and http/custom. The arm carries its own non-vacuity floor,
because a corpus where every operation resolved to no requirements would satisfy any implementation.
Its control drops OAuth2 scopes from a requirement and names the operations that then disagree.

## [0.24.0] - 2026-08-29

A minor: **the `zod` peer range is now `^4.5.0`, because inside `^4.0.0` the emitted validator and
the document emitted beside it disagree about what a length bound means.**

### The defect, and why nothing here could see it

A length bound is counted in **code points** by JSON Schema, and Zod counted UTF-16 units until 4.5.
So `@maxLength(8) handle: string` published `maxLength: 8` and emitted `.max(8)` - the same keyword,
the same number, agreeing on every axis the suite had - and the two answered differently for
any input outside the BMP, in both directions:

| input                          | the document | the validator, before 4.5 |
| ------------------------------ | ------------ | ------------------------- |
| 8 emoji against `maxLength: 8` | accepts      | refuses                   |
| 2 emoji against `minLength: 3` | refuses      | **accepts**               |

The second row is a payload the contract forbids reaching a handler. Both were live in `0.23.0`.

**This is not an astral-plane curiosity.** It is any emoji in any bounded string field.
`@maxLength(100)` on user-supplied text refused 100 code points of astral characters before 4.5 and
accepts them after, which is the "refuses a conformant caller" direction reached by ordinary use
rather than by a probe.

**Every oracle here compared the two as DESCRIPTIONS** - the shape describers over `._zod.def`, and
`z.toJSONSchema()` beside the document with nothing from this package in between. Both report
perfect agreement about a pair that answers differently the moment a value arrives, because a
keyword and its SEMANTICS are two facts and only the first is written down. `portability.test.ts`
requires ASCII source, so no fixture had ever carried an astral character either.

`z.iso.datetime({ offset: true })` is the same story smaller: RFC 3339 mandates seconds, and minute
precision was accepted until 4.5.

### Added

- **`test/conformance/behaviour.test.ts`**, which puts one value through Ajv 2020-12 on the document
  and through the emitted validator, over the whole corpus, and requires the same verdict. Ajv runs
  **without** `ajv-formats`, because `format` is an annotation under 2020-12 - which is this
  emitter's own stated position - and `probes.ts` generates values satisfying the document's `format`
  so the declared-scalar checks never produce a false divergence. There is no exception set.

  Both directions are graded and they are not the same failure: a validator stricter than the
  document refuses conformant callers, and one looser than it lets a forbidden payload through. The
  single remaining asymmetry is asserted as a CLASS - a `@discriminator` base publishes as an ordinary
  object, `discriminator` is not a JSON Schema validation keyword, and the emitted
  `z.discriminatedUnion` enforces what OpenAPI's prose says the document means. It is required to be
  the STRICTER direction, never the looser one.

- **`test/reference/constraints.tsp` declares a bound above 1.** With `@minLength(1)` a code-point
  count and a UTF-16 count coincide for every input, so the looser direction was unreachable by any
  fixture in the corpus.

### Fixed

- **The `z.toJSONSchema` axis was reading the wrong node under 4.5, and the emitter was right.**
  A registered ROOT is now extracted into `$defs` like any other registered schema, so the top level
  is a bare `{ $ref: "#/$defs/<id>" }` - and the normaliser drops `$defs`, taking the whole body with
  it. 249 components compared as an empty self-reference. Measured on both versions rather than
  inferred. Same direction as the `pipe` finding in `shape.ts`: measure a divergence against the
  runtime before editing `src/`.

- **A primitive union is spelled two ways and they mean the same thing.** 2020-12 lets `type` take an
  array, openapi3 publishes `anyOf`, and zod 4.5 emits the array where 4.4.3 emitted `anyOf`. Both are
  canonicalised, and only where every member is exactly `{ type: <string> }` so there is nothing to
  distribute. Safe to canonicalise a spelling **because** `behaviour.test.ts` now grades the
  semantics: were the two forms ever to differ, it would surface as a verdict rather than vanish here.

- **`z.httpUrl` and `z.creditCard` are refused by `vocabulary.test.ts`** like every sibling format
  check. `httpUrl` had been missing from the class since it was written, so switching `url` to it
  would have passed; `creditCard` is new in Zod 4.5 and no document derives one.

- **Two stale claims.** `docs/reference.md` said the emitted validators use `.strict()` and
  `.loose()`; openness has been `z.strictObject`/`z.looseObject` since `0.17.0` and neither suffix
  appears in any emitted file. `src/constraints.ts` still described `@refine` as a decorator of this
  package on its way out; it is gone, and this package exports no decorators.

### Added

- **`compile-schemas`, an option that wraps every emitted validator in `z.compile()`.** Zod 4.5's
  ahead-of-time compiler walks a schema once and emits a flat, loop-free function through
  `new Function`, falling back to the ordinary parser for anything it cannot handle. Measured on an
  emitted five-property model at zod 4.5.2, 200k iterations: `safeParse` 371 ns -> **51 ns**.

  **Off by default, because it is a trade.** Compilation runs at module scope, so it costs startup in
  proportion to the number of schemas - about 3 ms per 25 declarations - and buys nothing until enough
  requests arrive to repay it.

  **It is transparent, and that was measured before a line was emitted.** `z.toJSONSchema` output is
  byte-identical, `_zod.def` is unchanged and still readable, and verdicts AND parsed values match for
  every construct this emitter writes, including `z.preprocess`, `.exactOptional()` and a cycle. So
  the differential and the shape describers are unaffected, and `test/compile/` compares the two
  builds against each other - same spec, one option apart - rather than trusting that.

  **A DEFERRED declaration is never wrapped, and finding out why cost a real bug.** A cycle closing
  through a named union emits `z.lazy()` whose body forward-references a `const` declared further down
  the module. Wrapping it produced output that imported cleanly and then threw
  `Cannot read properties of undefined (reading '_zod')` on the **first parse** - a failure that
  reaches a running server rather than a build. `z.lazy()` is on Zod's own list of uncompilable
  constructs, so nothing is lost. The skip is keyed on the fact the registry already holds rather than
  on the shape of the emitted text; a cycle whose back edge sits on a GETTER is a different case and
  is compiled like any other.

  **On Cloudflare Workers this is the only route to a compiled schema**, verified on `workerd`:

  |                              | compiled fast path present?         |
  | ---------------------------- | ----------------------------------- |
  | this option, at module scope | **yes**                             |
  | Zod's `import "zod/compile"` | no, before or after the first parse |

  `new Function` is permitted during a Worker's STARTUP phase, which is when module scope runs. Zod's
  global mode compiles lazily on first parse, which happens inside a request, where the runtime
  refuses it - and it degrades silently rather than failing, so nothing about it looks wrong.

### Changed

- **An optional property is emitted `.exactOptional()`, and the `Exact<>` helper is gone.**

  **`exactOptionalPropertyTypes: true` is what makes this a non-event, and it is worth saying which
  projects it is not.** Under that flag `{ p: undefined }` is already a type error at the
  construction site, so a project that sets it finds nothing to change. A project WITHOUT the
  flag should expect to find construction sites, because a value that used to validate now does not.

  The document says the KEY may be absent and nothing more. `.optional()` additionally accepts an
  explicit `undefined`, and **JSON cannot carry one** - so for a body the validator admitted a value
  no conformant request can contain, and for a parameter one no transport produces.

  **The emitted TYPE has said this since `0.17.0` and only the validator disagreed.** `Exact<>` was a
  mapped type written to strip `| undefined` back off `z.infer`, with a docblock arguing exactly this
  point - so one program published a type refusing `{ note: undefined }` beside a validator accepting
  it, and nothing compared them. It survived three releases because no arm ran a value through the
  schema. `test/optionals/` now grades both halves, and they fail together.

  `z.infer` of `.exactOptional()` is `p?: T` natively **and at every depth**, which the shallow mapped
  type never managed, so the helper is deleted rather than kept beside it. Measured on 4.5.2 first:
  `z.toJSONSchema` is byte-identical for the two spellings and `def.type` is still `"optional"`, so
  neither the serialisation axis nor the shape describers move.

  Breaking in one direction: code passing an explicit `undefined` to an emitted validator now gets a
  rejection. Under `exactOptionalPropertyTypes: true` the emitted type already forbade it; under the
  default `false` it compiled.

  **`requests.gen.ts` still publishes `?: T | undefined`, unchanged and deliberately.** Those types
  are the floor a PRODUCER supplies, and `{ p: undefined }` serialises identically to omitting `p`, so
  refusing it there would cost every producer a conditional spread and buy the wire nothing -
  narrowing that surface was tried in `0.19.0` and reverted. `Declared<>` now widens the inferred side
  on that one axis before comparing, in the same pass rather than a second deep one.

- **`zod` peer range `^4.0.0` -> `^4.5.0`.** Breaking for a consumer pinned below 4.5.

## [0.23.0] - 2026-08-29

A minor: **`default` is an annotation, and this emitter treated it as an optionality.** Both halves of
that were wrong in opposite directions - the validator accepted a request the document forbids, and
the contract type refused one the document permits. A caller building requests against
`requests.gen.ts` had to supply values its spec says are not needed.

### The rule, and where it comes from

`default` is an ANNOTATION under JSON Schema 2020-12 section 9.2 and `required` is the assertion.
`@typespec/openapi3` implements exactly that: `#requiredModelProperties` builds the `required` list
from `metadataInfo.isOptional` alone and never consults a default, then attaches the default beside
it as a plain `schema.default`. The parameter side is the same rule spelled differently,
`required: !param.optional`.

OAI/OpenAPI-Specification#1543 is closed COMPLETED on this exact question. The JSON Schema editor:
_"`default` documents behavior when a field is absent. It does not cause the default value to be
written in to an instance... it has no impact on validation... Some validators will, for convenience,
provide the option to write the default in just before validation... But it is **NOT** part of
validation."_ The OpenAPI maintainer, on the combination itself: _"I am recommending that we remove
the `default` because it risks making the `required` notion invalid and encourages clients to
unnecessarily send `default` values over the wire."_

### Fixed

- **A property the document publishes as OPTIONAL is now optional in `requests.gen.ts`.** It was
  emitted required, because the type was shaped to match `z.infer` - the OUTPUT type, where a default
  has already fired. That is the right answer for a handler and the wrong one for the file: these
  types are the floor a PRODUCER supplies, and for a request the producer is a caller who has not run
  the validator. So any caller building a request had to supply a value the spec says it does not
  need.

  A helper relaxing named properties by hand reaches the TOP level only: a default one level down
  stays required through it and no caller can build the value at all. Emitting the optionality on the
  property itself has no depth to reach.

  This is the permissive direction on the axis that matters - a required property becoming optional
  makes MORE values assignable - so a handler returning what it was given still compiles. That is the
  distinction from removing `| undefined`, which looks like the same class and is the opposite.

- **A property the document publishes as REQUIRED is now required by the validator.** `.default(v)`
  makes a Zod field optional on the way IN, so a request omitting it was accepted by this emitter's
  validator and refused by the document generated beside it. The default is now emitted only where
  the document says the property may be absent.

### Added

- **`default-on-required-property`, a warning** - and this package's first. It names a property
  carrying a default that the document publishes as `required`, where the annotation can never apply
  because a required property is never absent, and states the one-character fix.

  **A warning rather than a refusal, for a reason this package has already learned once.**
  `unsupported-default` used to be an error on composite literals and was retired because refusing a
  construct `@typespec/openapi3` emits makes the same spec representable by one emitter and not the
  other - the one thing a differential between the two cannot tolerate. This spec IS representable.
  What is wrong with it is that the author has written something that does not mean what they
  intended, and silently tightening the validator instead would turn working requests into 400s at
  deploy time with no signal at all.

### Changed

- **`wire-contract.gen.ts` pairs `z.input`, not `z.infer`.** The assertion compares the emitted
  validator against the framework-free type, and the type states what a caller may SEND, so the side
  to compare is what the validator ACCEPTS. Measured on zod 4.4.3, `.default()` is the only construct
  this emitter emits where the two differ. With the fixes above in place, `z.input` and the document's
  `required` list agree property for property, so the assertion cross-checks the new rule rather than
  restating one side of it.

- **A cyclic declaration is annotated `z.ZodType<T, T>` rather than `z.ZodType<T>`.** `z.ZodType<T>`
  means `ZodType<Output = T, Input = unknown>`, so the annotated schema reported `z.input` as
  `unknown` - and so did every schema referencing it, which took the whole cyclic corner of the
  emitter out of the only check that catches it disagreeing with itself. One structural type serves
  both positions; where a cycle carries a defaulted property that type is the INPUT shape, which is
  the permissive direction: every value that arrives still satisfies it.

### Tested

- **`test/reference/defaults.tsp`**, a new differential depth source. Measured across every document
  the suite compiled, **zero** component schemas carried a property-level `default`, so the
  arm comparing emitted validators against `@typespec/openapi3`'s output had never once seen the
  keyword. That is how a default came to be implemented as the one thing it is defined not to be
  without any arm noticing. `default` is still COMPARED rather than excused as an annotation:
  measured by control, rendering a wrong default value turns the differential red.

## [0.22.0] - 2026-08-15

### Fixed

- **Only the first success status got an arm, so `armFor` could never select the second.**
  `model Created { @statusCode statusCode: 200 | 201; @body body: Item }` publishes both statuses in
  the document; one arm was emitted, so a route answering 201 on create and 200 on update had no way
  to say so.

  **The only mechanism for a second arm was `statusDiscriminatorOf`**, which infers the choice from a
  required literal property on one of the bodies. Measured across the whole conformance corpus, it
  fires **zero times** - the dual-arm path had never been emitted by any spec, so this was not a gap
  in a working feature, it was a feature nothing exercised.

  A `@statusCode` typed as a union is now the selector, because it is the one the spec already wrote:
  one arm per declared status, each keyed `when: { property: "statusCode", value: <status> }`. The
  discriminator remains for what it was written for, two DIFFERENT response models.

### Added

- **`EmittedRoute.statusSelector`**, and **a `type` on every published response header.** Both exist
  so a wrapping emitter can put the envelope into the type a handler returns. `@statusCode` and
  `@header` properties are stripped from the body schema - correctly, they are not body - so the arms
  named properties the handler could not set. Measured on `payload__head`: an arm naming
  `contentType` and `metadata` against a handler declared `Awaitable<Result<void>>`, an envelope
  contract published and unsatisfiable.

- `ResponseArm.when.value` accepts a **number**, which a status selector needs.

## [0.21.0] - 2026-08-15

### Fixed

- **`Simplify<T>` was written into every `requests.gen.ts`, used or not.** A service whose operations
  take no input has nothing to flatten, so the declaration sat there unreferenced and
  `noUnusedLocals` - which a generated file has to pass like any other - made it a compile error:
  `TS6196: 'Simplify' is declared but never used.` It is now emitted only where an input alias
  actually names it, decided from the aliases rendered rather than by searching the output.

  **Third of its kind**, after the unconditional `zValidator` (0.7.0) and `z` (0.9.0) imports, and it
  bites on the same shape both did: two parameterless `GET`s, which is where a health check starts
  and therefore where a new spec starts.

- **The arm that compiles emitted output now sets `noUnusedLocals` and `noUnusedParameters`**, which
  it never had. That is why all three shipped: the harness was green while a build under those flags
  was not. The sibling package's own harness has set both since it was written. Measured across the
  whole corpus with the flags on - `Simplify` was the only offender left.

## [0.20.0] - 2026-08-15

### Added

- **`EmittedRoute.optionalBody`**, so a wrapping emitter can tell that the document publishes
  `requestBody.required: false`. **A body that may be absent cannot be flattened into an
  operation's input**: a merge has no way to say "these properties are here only sometimes" without
  making every one of them optional, which is a weaker and different claim about the body that IS
  sent. So an optional body is now NAMED, exactly as an indexed one already was.

## [0.19.1] - 2026-08-15

### Fixed

- **A property whose declared type is a dictionary was destroyed by the wire assertion.**
  `Declared<>`, introduced in `0.17.0`, strips index signatures so that the two artefacts can be
  compared modulo an open model's `.loose()` catchall. It recursed into every object type, so a
  property declared `Record<unknown>` - where the index signature IS the type, stated identically in
  both artefacts - was flattened to `{}` and `wire-contract.gen.ts` stopped compiling.

  **An index signature arrives two ways and only one of them is openness.** It is now dropped only
  from a shape that has declared keys beside it, and kept - with its value type still mapped - from
  one that does not. That is the same rule `types.ts` already used to tell a dictionary from a model:
  a string indexer means "dictionary" only when nothing is declared next to it.

## [0.19.0] - 2026-08-15

### Added

- **`Produced<T>` is exported from `requests.gen.ts`.** It existed, it was applied to `WireOutputs`,
  and it was declared locally - so a codebase whose layers hand back `readonly T[]` had the producer
  view sitting in the file it was already importing and no way to name it. Its own docblock had said
  the right thing since it was written: _"Mutability is not a fact about a wire shape."_

- **`unmirrorable-seal`**, a new refusal. `seal-object-schemas` is settable per service, and
  `@typespec/openapi3` has no per-service options - it applies one value to the whole program. So
  services that seal differently cannot both be mirrored, and one of them would publish a document
  that disagrees with the validator emitted beside it. That is the exact disagreement the option's
  own docblock warns about, and it was previously accepted without a word.

### Documented

- **`Exact<>`'s docblock claimed it narrows the inferred type to match "the contract". It does
  not.** The contract types
  keep `?: T | undefined` deliberately: they are the floor a PRODUCER supplies, and
  `{ p: undefined }` serialises identically to omitting `p`.

  **Removing it was implemented, measured and reverted.** It looks like the same class as the open
  model's index signature and it is the opposite: dropping an index signature makes MORE values
  assignable to a published shape, removing `| undefined` makes fewer. It broke
  `(ctx, input) => ok(input)` - return what you were given - because what a handler RECEIVES carries
  `| undefined`. The two emitted surfaces differ on this axis on purpose, as they do on openness:
  `schemas.gen.ts` is the narrow received view, `requests.gen.ts` is the permissive floor.

## [0.18.0] - 2026-08-15

A minor: **a multipart part declared `HttpPart<File>` is now typed as a file**, so
`input.file.name` reads without a cast. `0.17.0` documented this as blocked; it was not.

### Changed

- **`HttpPart<File>` emits `z.unknown().refine(...)` narrowing to
  `{ name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> }`**, structurally rather
  than as `File` so emitted output still depends on no ambient library - `File` is reachable only
  through `lib.dom` or `@types/node`, and this package's own emitted-output typecheck runs with
  `types: []` so that such a dependency cannot creep in. Every member the type claims is verified, so
  the narrowing is established rather than asserted.

  **Why this is derivable, which is the rule `test/vocabulary.test.ts` enforces.**
  `@typespec/openapi3` publishes a bare `{}` for such a part, in 3.1 and even where the part declares
  a content type. That is OpenAPI's idiom for binary content in a multipart body, not a statement
  that any value is acceptable, and the transport agrees - Hono types a multipart part as
  `string | File` and nothing else. So the check refuses exactly one thing: a text field where the
  spec declared a file, which is malformed against the spec the document was projected from. **A spec
  that means "either" writes `HttpPart<File | string>`**, so nothing becomes inexpressible; the
  declaration simply means what it says. Previously that same request reached a handler as an
  unusable value and became a 500 or a silent misreading rather than a 400 naming the part.

  `bytes` parts are deliberately NOT covered. `bytes` says only that the payload is binary, and a
  client may legitimately send it as an ordinary form field.

  `z.unknown().refine()` rather than `z.custom<T>()`: measured on zod 4.4.3, `z.toJSONSchema` throws
  `Custom types cannot be represented in JSON Schema` on the latter, which silently took four corpus
  schemas out of the differential comparing these validators against the document. The refined form
  serialises to `{}` - exactly what openapi3 publishes - so that comparison keeps working.

- **`test/vocabulary.test.ts` admits this one `.refine` as a SHAPE**, written out literally, beside
  the `z.preprocess` carve-outs and on the same footing: it cannot turn a valid payload into an
  invalid one. It has its own non-vacuity floor, so an exemption that outlives what it exempted
  fails rather than passing quietly. Measured: changing the emitted refinement by a single check
  turns both arms red.

## [0.17.0] - 2026-08-15

A minor, and mostly a reversal: **`0.16.0` put an index signature on an open model's emitted type,
and that made the published shape unsatisfiable by most of the types a codebase already has.**

### Changed

- **An open model's contract type no longer carries `[key: string]: unknown`.** `0.16.0` added it so
  the type, the validator and the document all said `additionalProperties`. Two of those describe
  what is TOLERATED ON ARRIVAL; on the type it reads as an obligation on whoever produces the value.
  TypeScript gives an `interface` no implicit index signature and a `type` alias one
  (microsoft/TypeScript#15300), so whether a producer could satisfy a published shape came to depend
  on which keyword its own types happened to use. Where an open component nests another, satisfying
  it meant a structural deep copy of the response tree per response, and a single spread reached only
  the outermost level.

  **What arrives is still described honestly.** `schemas.gen.ts` exports
  `Exact<z.infer<typeof x>>`, derived from the validator, and that keeps the index signature because
  a loose parse really does pass unknown keys through. Two surfaces, two directions, neither lying.

- **`wire-contract.gen.ts` compares declared properties.** With the two sides now describing
  different directions, the emitted `Identical<>` would no longer compile. It applies a `Declared<>`
  view to the inferred side only - so a contract type that grew an index signature of its own still
  fails - and **the openness claim moved to its own arm** rather than disappearing: that an open
  model gets a permissive validator is asserted directly now, where before it was only ever a side
  effect of this comparison.

- **`z.looseObject({...})` and `z.strictObject({...})` everywhere**, rather than `.loose()` and
  `.strict()` suffixes where no cycle forced the constructor form. It is what Zod 4 asks for - its
  own types say "Consider `z.looseObject(A.shape)` instead", and `.passthrough()` is deprecated - and
  the constructors do not read `shape` eagerly, so a model that gains a back edge later no longer
  changes form. Emitted output changes for every model with an indexer or a seal.

### Documented

- **A multipart `File` part stays `unknown`, and now says why in the source.** Reading
  `input.file.name` needs a narrowing at the boundary. Every way of removing that was built and
  reverted: `z.custom<T>()` throws in `z.toJSONSchema` ("Custom types cannot be represented"), which
  silently dropped four corpus schemas out of the differential comparing validators against the
  document; `z.unknown().refine(guard)` serialises and narrows correctly but refuses a value the
  published contract permits, which `test/vocabulary.test.ts` forbids by class. The root cause is
  upstream: `@typespec/openapi3` publishes a bare `{}` for a File part even in 3.1, where
  `contentMediaType` could express it, and even when the part declares a content type.

### Added

- `test/contractshape/` compiles a hand-written consumer against the emitted output and requires a
  plain nested `interface` to be assignable to a response type **with no spread at any level**. It is
  the only arm in the package that asks whether the emitted types are satisfiable rather than
  well-formed, and it is the arm that would have caught `0.16.0`.

## [0.16.0] - 2026-08-14

A minor: two constructs made the emitter's OWN assertion fail on its own output, so
`wire-contract.gen.ts` did not compile. Both are the same defect - two walks over one TypeSpec
describing different shapes.

### Fixed

- **A `@multipartBody` reached the request type not at all.** `requestBodyOf` returns a type only for
  `bodyKind === "single"`, so the input was the headers and nothing else while the validator beside it
  had every part and the document published them. Measured:
  `UploadInput = { "Content-Type": "multipart/form-data" }` against
  `z.object({ file: z.unknown(), alt: z.string().optional() })`.

  Built from `body.parts`, mirroring `multipartSchemaOf` part for part, rather than from the parts
  model: walking the model types each part as its `HttpPart<T>` wrapper (`file: {}`) where the
  validator unwraps to `T`. `multi` becomes an array and `optional` an optional property, as there.

- **An open model's type lacked the catchall its schema infers.** `modelToZod` emits `.loose()` for
  `...Record<unknown>` so `z.infer` gains an index signature; this walk emitted the declared
  properties alone. Any spec with `...Record<unknown>` on a request model shipped output that does not
  compile.

  Emitted rather than compared away: the document says `additionalProperties`, the validator says
  `.loose()`, so the type saying it too is what makes all three agree. Relaxing the comparison would
  hide the disagreement rather than remove it. A model with an indexer and no declared properties is
  still a `Record<...>` outright, as before.

## [0.15.1] - 2026-08-14

A patch: `test/recordbody/` now covers a form body as well as a JSON one.

`0.15.0`'s fixture declared only a JSON `Record` body, and a declared
`content-type: application/x-www-form-urlencoded` takes a different resolution path. The library
handled it correctly either way; the fixture simply did not say so.

## [0.15.0] - 2026-08-14

A minor: `EmittedRoute` gains `bodyProperty`, and a body with an indexer is named rather than spread.

**A `Record` body beside any other parameter emitted a server that does not compile.** Intersected
with the parameters, the body's index signature is imposed on every sibling, so
`op x(@query q?: string, @body body: Record<string>)` failed with
`TS2345: 'q' is incompatible with index signature`.

**It was wrong before it failed to compile.** The document states the parameters and the body as
separate things; merged, a body key named `q` silently overwrites the query parameter of that name.
`bodyProperty` names the input property the parsed body arrives under, the same statement
`rawBodyProperty` already made about a `bytes` body. An ordinary model body is spread as before.

A header beside it is incidental: the trigger is a `Record` body beside any other input.

## [0.14.0] - 2026-08-14

A minor: every response arm now carries its media types, including where there is only one.

`contentTypes` was emitted only where a status offered several, on the reasoning that one type is
what an application already assumes. That reasoning assumed the one type is JSON. A `text/plain` arm
and a JSON arm were therefore indistinguishable to a generic `deps.respond` - the document knew and
the runtime did not - so a server had to restate the media type in its own result envelope to get
it back.

## [0.13.0] - 2026-08-14

A minor, and a **deliberate reversal of a documented decision**: a scalar the spec declares is now
checked.

### A declared type is checked

| declared                        | emitted                            |
| ------------------------------- | ---------------------------------- |
| `utcDateTime`, `offsetDateTime` | `z.iso.datetime({ offset: true })` |
| `plainDate`                     | `z.iso.date()`                     |
| `plainTime`                     | `z.iso.time()`                     |
| `duration`                      | `z.iso.duration()`                 |
| `url`                           | `z.url()`                          |

These emitted `z.string()`, so a service promising a timestamp accepted `banana`. The decision was
argued from `format` being an annotation under JSON Schema 2020-12, which is correct about the
KEYWORD and wrong about these: `utcDateTime` is not a string carrying a hint, it is a type the spec
declares, and emitting `z.string()` discarded it.

**The workaround it forced was worse.** Rewriting `utcDateTime` as `string` with a `@pattern` to
get the check loses `format: date-time` from the document AND gives a weaker check, since a
hand-written pattern accepts `2026-02-31`. A rule that pushes spec authors into writing worse specs is
the wrong rule.

**`{ offset: true }` was measured, and the old comment's warning was right.** A bare
`z.iso.datetime()` rejects `2026-08-14T12:00:00+01:00`, which the document permits, so it would have
refused conformant callers. With the offset permitted every legal instant is accepted and only
`2026-02-31` and `banana` are refused.

### `@format` on a plain string is still not enforced

That half is unchanged and is the other side of the same principle: a type is a claim about the
value, an annotation is a hint about it. Enforcing an author's `@format("uuid")` would add a rule the
contract does not state, and `@format("product-code")` proves no general rule exists.

The vocabulary guard that forbade every format-derived check now holds the new line instead of being
deleted: no check may come from an annotation, and a floor requires the type-derived ones to exist,
because "no annotation-derived checks" is also true of an emitter that checks nothing.

## [0.12.1] - 2026-08-14

A patch: a redirect emitted a duplicate arm.

`errorArmsOf` excludes 2xx from the failure arms, so widening the primary arm to include 3xx in
`0.11.0` put a redirect in both: `[{ status: 302, schema: undefined, headers: [...] },
{ status: 302, schema: undefined }]`, two arms for one status where the second claims no headers.

Deduplicated with the primary winning, rather than by widening the exclusion, because an operation
declaring a 200 AND a 302 has 200 as its primary and needs the 302 to stay a failure arm to be
emitted at all. Asking what was actually emitted keeps both cases.

Compiling a spec from a clean install of the published package shows it; the suite was green over
it.

## [0.12.0] - 2026-08-14

A minor: the emitted type of every optional property changes, and the banner can carry a project's
own regeneration command.

### Fixed

- **An optional property was typed as admitting an explicit `undefined`.** `z.infer` of `.optional()`
  gives `p?: T | undefined`, which under `exactOptionalPropertyTypes` means "absent, or T, or
  explicitly undefined". JSON cannot carry `undefined`, and the document says the same by leaving the
  property out of `required`, so the emitted type was wider than both the contract and the wire and a
  caller had to strip it at the boundary.

  Narrowed by a mapped type derived from the same schema, so there is still one source of truth: a
  mapped type cannot drift from the thing it maps. The oracle is a compile under
  `exactOptionalPropertyTypes` asserting all three cases - absent accepted, present accepted,
  explicitly undefined refused.

### Added

- **`regenerate-hint`**, written into every banner. `DO NOT EDIT` says what not to do and not what to
  do instead, and only the project knows whether that is `pnpm generate`, `npm run api` or a
  `tsp compile` with three flags. Omitted, the generic line is kept. Settable per service.

## [0.11.0] - 2026-08-14

A minor: `EmittedRoute` gains two fields, `ResponseArm` gains two, and an operation that used to be
dropped is now emitted.

Every item is a fact the OpenAPI document already publishes, so nothing here is invented.

### Fixed

- **An operation whose only declared response is a redirect was dropped entirely, with no
  diagnostic.** Routes were collected from a status filter accepting 2xx only, so a `302` gave no
  status and the operation was skipped by a bare `continue`. The document declared the route and the
  emitted output had no trace of it, so a client generated from that document would 404 while the
  compile reported success. A `Location` on a 302 and an OAuth redirect are the ordinary cases.

  Statuses below 400 are collected now. 4xx and 5xx stay out: those are error arms, and a handler
  does not reach one by returning normally. Additive by construction, and measured rather than
  hoped - across the whole conformance corpus, ZERO operations declare a response set without a 2xx,
  which is why nothing caught it and why no existing count moved.

### Added

- **`ResponseArm.headers`**, so `deps.respond` can set a header the contract promises. A spec may
  declare `@header` on a response model and the document publishes it under `responses.<code>.headers`;
  the arm carried a status and a body schema and nothing else. Each entry pairs the WIRE name the
  response must set with the `property` on the returned value the value is read from, because
  `@header("x-request-id") requestId` differs in both and an emitter given one would guess the
  other.
- **`ResponseArm.contentTypes`**, present where a status offers more than one media type. An operation
  whose one status offers `application/json` and `text/event-stream` emitted a single arm holding the
  JSON schema and dropped the alternative from the list, so a non-JSON operation could not be served
  faithfully. Absent for a single type, which is what an application already assumes.
- `EmittedRoute.responseHeaders` and `EmittedRoute.responseMediaTypes` carry the same two facts per
  status for a wrapping emitter.

## [0.10.0] - 2026-08-14

A minor: `EmittedRoute` gains a required field, and the emitted output of a spec using reserved path
expansion changes.

### Added

- **`EmittedRoute.reservedPathParameters`**, the wire names of path parameters declared with RFC 6570
  reserved expansion, so a value may contain `/`. A hierarchical identifier is one value rather than
  several segments: a file path such as `docs/guide.md`, an S3 key or a GitHub file path. Always
  present, empty when none.

  Read from `allowReserved` on the parameter, never by parsing the template: `@typespec/http` strips
  the operator before this emitter sees the path, and the flag can also be set with no operator in the
  template at all, so the template is a derived artefact rather than the source of truth.

  `typespec-hono` renders it as Hono's `:name{.+}`.

- **The conformance differential now runs at OpenAPI 3.1.0 and 3.2.0.** Derived rather than recalled:
  every version branch read from openapi3's source, then the whole corpus compiled at both versions and
  the documents diffed structurally, over 72 documents, 665 operations and 372 component schemas.
  Exactly one scenario differs, `streaming/sse`, where 3.2 replaces a string schema with `itemSchema`
  describing the event envelope. That turns five previously unreachable components into graded pairs.

  The matrix costs 5 percent rather than double: the TypeSpec compile happens once and only
  serialisation repeats.

### Fixed

- **A document arm could have passed over zero documents.** Given one entry in `openapi-versions`
  openapi3 writes `<outDir>/openapi.json`; given more than one it writes
  `<outDir>/<specVersion>/openapi.json`. The document arms located files with a flat scan, so moving to
  a matrix without teaching them the layout would have made every one of them find nothing and report
  success. The per-version floor landed before the version moved.

## [0.9.0] - 2026-08-14

**`0.8.0` announced a fix it did not deliver. This is that fix.**

A minor rather than a patch because emitted output changes relative to `0.8.0`, and a caret range on
`0.x` does not cross a minor, so a consumer opts in rather than receiving it.

### Fixed

- **The Zod import is decided by whether the emitted content names `z`, not by whether there are
  declarations to emit.** `0.8.0` counted declarations, which is not the same question: a service
  whose every operation returns `void` HAS route declarations, they are just
  `{ status: 204, schema: undefined }` and name nothing. So the import was still written and still
  unused, and `0.8.0` shipped with the defect it claimed to close.

  The content decides now, tokenised on the language's own identifier rule rather than searched as a
  substring, so `z` can be neither found inside `zValidator` nor missed beside a bracket.

  A compile of generated output under `noUnusedLocals` catches it, and none ran before `0.8.0` was
  published.

## [0.8.0] - 2026-08-14

A minor because it changes emitted output: a file that needs no Zod no longer imports it.

### Fixed

- **`import { z } from "zod"` was written unconditionally**, so a service whose every operation takes
  nothing and returns `void` emitted an import nothing used and failed the build with
  `TS6133: 'z' is declared but its value is never read`, from a compile that reported success. It is
  now decided from the declarations, like the `ResponseArm` import beside it.

  Two bare `GET`s is where a health check starts, so it is where a new spec starts.

## [0.7.0] - 2026-08-14

A minor: several shapes that emitted TypeScript which does not parse now emit valid declarations, so
their names and forms change, and three refusals are new.

Every fix below was found the same way, by compiling generated output and by reading every generated
file for a name declared twice. None was visible to a comparison against the document: the document
was right in all of them, and the emitted file did not compile.

### Added

- **`portability.test.ts` asserts every tracked file is ASCII**, naming file, line and codepoint. The
  rule was standing and unguarded, so a non-ASCII character in a docblock left the suite green. The
  report names the codepoint because the character that matters is the one nobody can see.

### Fixed

- **Operation ids are deduplicated the way the document deduplicates them.** `resolveOperationId`
  names an operation from its immediate parent container, so two interfaces of the same name in
  different namespaces both resolved to one id, and every declaration keyed on it was emitted twice:
  `TS2451`, 72 of them on one conformance scenario, from a compile that reported success. openapi3
  publishes `Standard_primitive` and `Standard_primitive_2`; so does this now, including the rule that
  an explicit `@operationId` is never renamed or reserved.
- **A type is declared once per name.** Visibility projection hands the registry a different type
  object for one declared model, so a model reached under two visibilities was emitted twice.
  `parameters/body-optionality` declares one `model BodyModel` and produced two byte-identical
  `export interface BodyModel`.

### Added

- **`duplicate-operation-id`**, for an explicit `@operationId` another operation already answers to.
  Derived ids are deduplicated silently; an explicit one is the author's and cannot be renamed to make
  room, so it is refused with both remedies named.
- **`duplicate-declaration`**, for two different types claiming one TypeScript name. A repeat of the
  same declaration is not this and is collapsed silently.

- **A discriminated union with the default envelope emitted `export interface X { ... } | { ... }`,
  which is not valid TypeScript.** Whether a body could be an `interface` was decided by testing the
  rendered text for an intersection, which the union form does not contain. The file did not parse at
  all. This is the shape a spec gets from writing `@discriminated` and nothing else, not the
  `envelope: "none"` form that is refused. Decided by balanced braces now: an interface is valid
  exactly when the whole body is a single `{...}`, whatever it contains.
- **A model named after a reserved word emitted `export interface await` and
  `export type break = ...`.** Both are `TS2427` and the parser gives up after the first. Such names
  now carry a trailing `_`, applied in one place so both walks agree and the wire assertions still
  pair by name.

### Changed

- **Import detection tokenises the rendered source once and tests identifiers by equality**, rather
  than building a pattern per name. A pattern is wrong for any name carrying a regular-expression
  metacharacter, and a substring test is wrong for any name that prefixes a longer one; tokenising
  has neither failure and needs no escaping to stay correct.
- `test/reference/identifiers.tsp` is compiled by `tsc` alongside the other emitted output, proving
  that identifiers carrying a `$` emit and compile at all.

## [0.6.0] - 2026-08-14

A minor: an emitted parameter validator gains a decoder it did not have, so a consumer who
regenerates gets different output.

### Fixed

- **A parameter whose type is a union of numeric or boolean literals is decoded from the wire.**
  `@query size: 10 | 25 | 50` emits `z.union([z.literal(10), ...])`. Whether to wrap a decoder around
  a parameter was decided by inspecting the emitted Zod text for a `z.number()` prefix, and that
  expression has none, so **every conformant caller got a 400**: measured, `?size=25` rejected and
  `size: 25` accepted, against a document that says the parameter is a number with an enum of three
  values. No document comparison could see it, because both sides agree - the disagreement is with
  the wire. The decision now reads the TYPE, resolving `@encode` on the property first, so the
  spelling of the emitted expression cannot change the answer.

### Added

- **`test/wire/` asserts the class**: every numeric or boolean parameter accepts the string a server
  hands over, across plain scalars, named scalars with constraints, literal unions, optional and
  nullable wrappers, and flattened lists. Restoring the text inspection reddens it by name.
- **`test/mediatypes/` grades `EmittedRoute.requestContentTypes`** against the media types
  `@typespec/http` resolves for the body. Truncating it to one entry previously left the whole suite
  green, which mattered because that field exists to stop a server parsing a body as the wrong thing.
  `compileFixture` now returns the compiled program, since nothing could reach the published API at
  all.

### Changed

- **Import detection bounds an identifier by identifier characters, not by `\b`.** Whether a generated
  file imports a name was decided by a pattern built from the name itself, interpolated unescaped.
  `$` is a valid identifier character in JavaScript and in TypeSpec and an anchor in a regular
  expression, so a name containing one failed to match itself and its import would have been dropped,
  leaving the emitted module referencing an undeclared identifier. Only `SPEC_VOCABULARIES` reaches
  that seam today, so it was latent rather than live.

## [0.5.0] - 2026-08-14

A minor: `schemas.gen.ts` changes shape for exploded array parameters, and a model closed with
`Record<never>` now emits where it previously refused.

### Fixed

- **A single occurrence of an exploded array parameter validates as the one-element list it is.**
  `zValidator` hands a repeated key over as an array and a single occurrence as a bare string -
  and one `key=value` pair is exactly what a one-member exploded array looks like on the wire. The
  emitted `z.array()` accepted `?topics=a&topics=b` and refused `?topics=a`: the same list refused
  or admitted by its length, which no document describes. The validator now boxes a lone string
  into the one-element array before the schema runs, the mirror of the delimiter split - and like
  it, a wire decode of a documented `style`/`explode` fact, so the vocabulary guard permits the
  shape and carries its own non-vacuity floor.

- **`Record<never>` seals a model instead of refusing it.** `model A { ...Record<never>; name: string }`
  gives an indexer whose value is the `never` intrinsic. Read as an ordinary typed catchall it became
  `.catchall(z.never())`, reached the intrinsic and refused the compile, while `@typespec/openapi3`
  publishes the same model cleanly as `additionalProperties: {not: {}}`. `isSealed` already read a
  `never` indexer as sealed; the catchall branch was consuming it first. A `never` variant in a union
  is dropped for the same reason, leaving the type it reduces to.

- **A spec with two `@service` namespaces emitted one file, and the second silently won.** Every
  service wrote `schemas.gen.ts` into `emitter-output-dir` under the same name, so a project
  publishing two surfaces got a single file holding whichever was walked last.
  Measured: two services, zero diagnostics, one file, the first service's validators absent entirely.
  Output is now disambiguated by service directory when a spec declares more than one, copying
  `@typespec/openapi3`'s `{service-name-if-multiple}` rule. **A single-service spec emits exactly
  where it always did**, so no existing output moves.

### Changed

- **A refusal points at a declaration rather than at `<unknown location>:1:1`.** An intrinsic has no
  source node, so pointing a diagnostic at it gave one identical unlocated message per occurrence,
  with nothing to grep for. The property or model being walked is carried through
  the walk and used instead, so each refusal names a line the reader can go and edit.
- **Every diagnostic names a remedy.** `unsupported-type`, `unsupported-default` and `empty-union`
  said what was wrong and not what to do. Asserted as a class over the declared set, so a diagnostic
  added later fails the suite until it says what to do about it.

## [0.4.0] - 2026-08-13

Additive. `0.3.0` remains correct and installable; nothing it emits changes.

### Added

- **A third conformance axis, comparing the emitted validators to the document through neither side's
  describers.** Every existing arm reads the emitted Zod through describers written here, and those
  describers have produced more defects than the emitter has. `z.toJSONSchema()` is Zod's own
  serialiser, so converting each emitted validator back to JSON Schema and comparing it against
  openapi3's component puts two independent implementations either side of the comparison. **247
  components compared, 0 divergences.** Floored, and shown to go red by dropping a real constraint
  from the emitter.
- **`docs/oracles.md`**, naming every artefact this emitter produces and what would catch it
  disagreeing with the thing it has to agree with. Every row was checked by planting a defect and
  confirming the named arm fails. Two artefacts generated by one program and compared by nothing can
  disagree unseen, so the list exists to make an uncompared pair visible.

## [0.3.0] - 2026-08-13

A minor bump rather than a patch. `requests.gen.ts` changes shape, and `^0.2.0` would install a
patch automatically: a consumer would find their generated types altered under them without opting
in. That is the case the policy above exists for, so this needs the opt-in a minor bump requires.

### Fixed

- **An HTTP parameter renamed on the wire is keyed by its wire name in the contract types.**
  `@header("x-thing") thing: string` was keyed `"x-thing"` by the emitted validator and `thing` by
  `RenamedHeaderInput`, so a handler written against the generated types could not typecheck against
  a server that was correct. The same applied to `@path("thing-id")` and `@query("$select")`.
- **A raw binary request body is typed `ArrayBuffer` rather than `string`.** A `bytes` body was typed
  `string` whatever media type it was served as, while a server hands the handler the bytes. The
  document publishes `application/octet-stream` with `format: binary` for such a body. This is the
  request half of the corruption fixed on the reader side earlier: decoding raw bytes as text
  replaces every byte outside ASCII. A `bytes` value inside a JSON payload is base64 and stays
  `string`.

### Added

- **An oracle comparing the two emitted artefacts against each other.** `schemas.gen.ts` and
  `requests.gen.ts` are generated by one program from one source and nothing read them together:
  `wire-contract.gen.ts` pairs a validator against a contract type for models, and a merged input
  type is not a model. `test/contracts/` now asserts, over every operation a fixture declares, that
  both name each parameter identically. Both defects above redden it by name.

## [0.2.0] - 2026-08-13

A minor bump rather than a patch, under the policy above: every change below alters the emitted
output, so a consumer who regenerates gets different validators.

### Fixed

- **An unknown scalar is emitted as `z.unknown()` rather than refused.** `@typespec/openapi3`
  publishes `scalar Mystery;` as the empty schema `{}`, which asserts nothing and accepts any value.
  This emitter refused the compile and wrote `z.never()`, which accepts none: `"hello"`, `42` and
  `null` were all rejected. The `unsupported-scalar` diagnostic is retired.
- **A `never` property is dropped from the schema rather than emitted as `z.never()`.** openapi3 omits
  such a property from the document entirely, so `model N { value: never; other: string }` publishes
  as `{other}` with `required: ["other"]`. The previous emission made the model unsatisfiable: the
  exact body the document describes was rejected.
- **Composite default values are emitted.** `#["a", "b"]` and `#{ x: 1 }` were refused with
  `unsupported-default`, while openapi3 publishes `default: ["a","b"]` and `default: {"x":1}`. Arrays
  and objects nested to any depth are now emitted as literals. A default with no literal form, such as
  the scalar constructor `utcDateTime.fromISO(...)`, is still reported.
- **A cycle that closes through a union variant or a dictionary value is emitted rather than
  refused.** Such a cycle has no object property to hang a getter on, so `circular-model` refused it.
  It is now deferred with `z.lazy()`, and every declaration on the cycle carries a structural
  TypeScript type with the deferred one annotated `z.ZodType<T>`, which is what keeps `z.infer` from
  resolving to `any`. The `circular-model` diagnostic is retired.

### Changed

- `schemas.gen.ts` declares a structural `interface` or `type` for any component on a reference cycle,
  in place of the usual `z.infer<typeof ...>` alias. Output for a spec with no cycle is unchanged.
- Two diagnostics are retired, leaving six: `unsupported-type`, `unsupported-default`, `empty-union`,
  `unknown-key-vocabulary`, `unsupported-status-code-range` and `undeclared-discriminator`.

### Documentation

- The README is a starting page: install, quick start with a worked example, what it emits, and links
  to `docs/guides.md` and `docs/reference.md`. Options, diagnostics and known limits move to the
  reference.
- `int64` and `uint64` above `2^53-1` are documented as a limit, with `@encode(string)` as the remedy.
- Every tracked file is ASCII.

## [0.1.0] - 2026-08-13

First release.

### Added

- **The emitter.** A TypeSpec HTTP service becomes `schemas.gen.ts` - every component validator, and
  each operation's path, query, header, body and response validators, plus the `ResponseArm[]` it may
  answer with. With `contracts-output-dir` set it also emits `requests.gen.ts` (framework-free
  contract types, no imports), `vocabularies.gen.ts` (each enum as a runtime tuple), and - with
  `contracts-package` - `wire-contract.gen.ts`, which asserts the emitted Zod infers exactly those
  types so the two walks cannot disagree silently.
- **The library.** `emitHttpZod`, `collectRoutes`, `EmittedService`, `EmittedRoute`,
  `RouteSchemaNames`, `StatusKey`, `successStatusOf`, `successStatusesOf`, `errorBodyOf`,
  `isRawBinaryMediaType`, `objectKey`, `EmitterOptionsSchema`, `DEFAULT_RUNTIME_MODULE` and `$lib` -
  what an emitter for another framework calls. `typespec-hono` is built on it.
- **`./runtime`** - `ResponseArm` and `armFor`, the latter applying OpenAPI's own response precedence
  so an application does not re-derive it. Deliberately free of every TypeSpec import, so an
  application never pulls the compiler into its runtime graph.
- **Options** - `seal-object-schemas`, `contracts-output-dir`, `contracts-package`,
  `key-vocabularies`, `runtime-module`, and per-`@service` overrides via `services`.

### Notes for a first adopter

- **Install as a regular dependency if you call `armFor`.** It is a function, so `--save-dev`
  typechecks, builds and runs in development and then fails on deploy with `ERR_MODULE_NOT_FOUND`. If
  you use only the emitted validators, `--save-dev` is sufficient.
- **Set `seal-object-schemas` to whatever `@typespec/openapi3`'s option of the same name is set to.**
  Neither emitter can read the other's configuration, and they answer the same question about the same
  models.
- **The emitted output requires `zod`, not `zod/mini`** - the tree-shakeable variant has no chained
  methods, and the emitted validators use six of them. Verified working across the whole declared
  `^4.0.0` peer range, at 4.0.0 and 4.4.3.

### Known limits

`format` is deliberately not enforced (an annotation under JSON Schema 2020-12, not an assertion);
4 negotiated response bodies cannot be attributed to a single arm; 4 response bodies reduce to no
readable kind on one side. Each is stated in the README and re-measured by the suite.

### Refuses

`unsupported-scalar`, `unsupported-type`, `unsupported-default`, `empty-union`, `circular-model`,
`unknown-key-vocabulary`, `unsupported-status-code-range` (because `@typespec/openapi3` refuses it,
with the same rule copied from its source) and `undeclared-discriminator` (upstream,
[`microsoft/typespec#7141`](https://github.com/microsoft/typespec/issues/7141)).
