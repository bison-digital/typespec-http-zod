# Changelog

All notable changes to `typespec-http-zod` are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**At `0.x` the public API is not frozen.** A minor bump may change the emitted output or the
published types; a patch will not. The **emitted output is part of the API** - a change to a
validator's shape, to a declared identifier, or to the `EmittedRoute` a wrapping emitter reads is a
change a consumer feels, and is treated as such here rather than as an implementation detail.

## [Unreleased]

A minor when released: an emitted parameter validator gains a decoder it did not have.

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

## [0.5.0] - 2026-08-14

A minor: `schemas.gen.ts` changes shape for exploded array parameters, and a model closed with
`Record<never>` now emits where it previously refused.

### Fixed

- **A single occurrence of an exploded array parameter validates as the one-element list it is.**
  (#1) `zValidator` hands a repeated key over as an array and a single occurrence as a bare string -
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
  publishing an internal surface and a public one got a single file holding whichever was walked last.
  Measured: two services, zero diagnostics, one file, the first service's validators absent entirely.
  Output is now disambiguated by service directory when a spec declares more than one, copying
  `@typespec/openapi3`'s `{service-name-if-multiple}` rule. **A single-service spec emits exactly
  where it always did**, so no existing consumer's output moves.

### Changed

- **A refusal points at a declaration rather than at `<unknown location>:1:1`.** An intrinsic has no
  source node, so pointing a diagnostic at it gave a consumer 32 identical unlocated messages against
  a 3,755-line spec, with nothing to grep for. The property or model being walked is carried through
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
  confirming the named arm fails. Both defects that reached a consumer were pairs nobody compared, so
  the list exists to make an uncompared pair visible before a consumer finds it.

## [0.3.0] - 2026-08-13

A minor bump rather than a patch. `requests.gen.ts` changes shape, and `^0.2.0` would install a
patch automatically: a consumer would find their generated types altered under them without opting
in. That is the case the policy above exists for, so this needs the opt-in a minor bump requires.

Both fixes were reported by a consumer against `0.2.0`, not found here.

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
