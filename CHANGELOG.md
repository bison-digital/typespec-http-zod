# Changelog

All notable changes to `typespec-http-zod` are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**At `0.x` the public API is not frozen.** A minor bump may change the emitted output or the
published types; a patch will not. The **emitted output is part of the API** - a change to a
validator's shape, to a declared identifier, or to the `EmittedRoute` a wrapping emitter reads is a
change a consumer feels, and is treated as such here rather than as an implementation detail.

## [Unreleased]

Nothing since `0.12.1`.

## [0.12.1] - 2026-08-14

A patch: a redirect emitted a duplicate arm.

`errorArmsOf` excludes 2xx from the failure arms, so widening the primary arm to include 3xx in
`0.11.0` put a redirect in both: `[{ status: 302, schema: undefined, headers: [...] },
{ status: 302, schema: undefined }]`, two arms for one status where the second claims no headers.

Deduplicated with the primary winning, rather than by widening the exclusion, because an operation
declaring a 200 AND a 302 has 200 as its primary and needs the 302 to stay a failure arm to be
emitted at all. Asking what was actually emitted keeps both cases.

Found by compiling a spec from a clean install of the published package, not by the suite, which was
green over it.

## [0.12.0] - 2026-08-14

A minor: the emitted type of every optional property changes, and the banner can carry a project's
own regeneration command.

### Fixed

- **An optional property was typed as admitting an explicit `undefined`.** `z.infer` of `.optional()`
  gives `p?: T | undefined`, which under `exactOptionalPropertyTypes` means "absent, or T, or
  explicitly undefined". JSON cannot carry `undefined`, and the document says the same by leaving the
  property out of `required`, so the emitted type was wider than both the contract and the wire and a
  consumer had to strip it at the boundary.

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

Every item was reported by a consumer as blocking, and every one is a fact the OpenAPI document
already publishes, so nothing here is invented.

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
  `@header("x-correlation-id") correlationId` differs in both and an emitter given one would guess the
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
  several segments: an Obsidian note is `areas/health.md`, and an S3 key or a GitHub file path is the
  same shape. Always present, empty when none.

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

  Caught by a fixture added to `typespec-hono` minutes after `0.8.0` went out, compiling generated
  output with `noUnusedLocals` for the first time. The guard existed after the release rather than
  before it, which is the whole reason a broken fix reached the registry.

## [0.8.0] - 2026-08-14

A minor because it changes emitted output: a file that needs no Zod no longer imports it.

### Fixed

- **`import { z } from "zod"` was written unconditionally**, so a service whose every operation takes
  nothing and returns `void` emitted an import nothing used and failed the consumer's build with
  `TS6133: 'z' is declared but its value is never read`, from a compile that reported success. It is
  now decided from the declarations, like the `ResponseArm` import beside it.

  Reported by the copal-gateway migration as an untested hypothesis while reporting the same shape in
  `typespec-hono`, and confirmed here by measurement. Two bare `GET`s is where a health check starts,
  so it is where a new consumer starts.

## [0.7.0] - 2026-08-14

A minor: several shapes that emitted TypeScript which does not parse now emit valid declarations, so
their names and forms change, and three refusals are new.

Every fix below was found the same way, by compiling generated output and by reading every generated
file for a name declared twice. None was visible to a comparison against the document: the document
was right in all of them, and the emitted file did not compile.

### Added

- **`portability.test.ts` asserts every tracked file is ASCII**, naming file, line and codepoint. The
  rule was standing and unguarded: a glyph went back into a `src/registry.ts` docblock the same day
  the sweep removed 815 of them, and the suite stayed green. It was found by a person reading the
  file. The report names the codepoint because the character that matters is the one nobody can see.

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
  has neither failure and needs no escaping to stay correct. `typespec-hono` reached the same
  conclusion after the defect went live there.
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
