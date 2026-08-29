# Changelog

All notable changes to `typespec-http-zod` are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**At `0.x` the public API is not frozen.** A minor bump may change the emitted output or the
published types; a patch will not. The **emitted output is part of the API** - a change to a
validator's shape, to a declared identifier, or to the `EmittedRoute` a wrapping emitter reads is a
change a consumer feels, and is treated as such here rather than as an implementation detail.

## [0.24.0] - 2026-08-29

A minor: **the `zod` peer range is now `^4.5.0`, because inside `^4.0.0` the emitted validator and
the document emitted beside it disagree about what a length bound means.**

### The defect, and why nothing here could see it

A length bound is counted in **code points** by JSON Schema, and Zod counted UTF-16 units until 4.5.
So `@maxLength(8) handle: string` published `maxLength: 8` and emitted `.max(8)` - the same keyword,
the same number, agreeing on every axis this repository had - and the two answered differently for
any input outside the BMP, in both directions:

| input                          | the document | the validator, before 4.5 |
| ------------------------------ | ------------ | ------------------------- |
| 8 emoji against `maxLength: 8` | accepts      | refuses                   |
| 2 emoji against `minLength: 3` | refuses      | **accepts**               |

The second row is a payload the contract forbids reaching a handler. Both were live in `0.23.0`.

**Every oracle here compared the two as DESCRIPTIONS** - the shape describers over `._zod.def`, and
`z.toJSONSchema()` beside the document with nothing of ours in between. Both report perfect agreement
about a pair that answers differently the moment a value arrives, because a keyword and its
SEMANTICS are two facts and only the first is written down. `portability.test.ts` requires ASCII
source, so no fixture had ever carried an astral character either.

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

- **`provenance.test.ts` walked corpus output while the suite that owns it was rebuilding it.** Its
  docblock said generated output is excluded and its code excluded only the directory spelled `.out`,
  not `.out-<suite>`. A race rather than a finding, and the code now matches the rule it states.

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
  appears in any emitted file. `src/constraints.ts` still described `@refine` as "still ours and on
  its way out"; it is gone, and this package exports no decorators.

### Changed

- **An optional property is emitted `.exactOptional()`, and the `Exact<>` helper is gone.**

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
the contract type refused one the document permits. Reported by a consumer building requests against
`requests.gen.ts` who had to supply values their own spec says are not needed.

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
  the validator. So a gateway, an MCP worker or a React app had to supply a value the spec says it
  does not need.

  The consumer who reported it carried a helper relaxing six named properties, and its own docblock
  named the limit: it reaches the TOP level only. A default one level down stays required through
  such a helper and no caller can build the value at all. Emitting the optionality on the property
  itself has no depth to reach.

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

- **`test/reference/defaults.tsp`**, a new differential depth source. Measured across every compiled
  document in this repository, **zero** component schemas carried a property-level `default`, so the
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
  and therefore where every new consumer starts.

- **The arm that compiles emitted output now sets `noUnusedLocals` and `noUnusedParameters`**, which
  it never had. That is why all three shipped: the harness was green while a consumer's first build
  was not. The sibling package's own harness has set both since it was written. Measured across the
  whole corpus with the flags on - `Simplify` was the only offender left.

## [0.20.0] - 2026-08-15

From `agent-books`, the largest port yet (~260 operations). All three findings reproduced; none was
covered by either suite, and all were found by compiling a real spec.

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
  both artefacts - was flattened to `{}` and `wire-contract.gen.ts` stopped compiling. Reported with
  four real properties behind it.

  **An index signature arrives two ways and only one of them is openness.** It is now dropped only
  from a shape that has declared keys beside it, and kept - with its value type still mapped - from
  one that does not. That is the same rule `types.ts` already used to tell a dictionary from a model:
  a string indexer means "dictionary" only when nothing is declared next to it.

## [0.19.0] - 2026-08-15

Three consumer reports. Two were valid, and one of the two was already fixed in the codebase and
simply unreachable.

### Added

- **`Produced<T>` is exported from `requests.gen.ts`.** It existed, it was applied to `WireOutputs`,
  and it was declared locally - so a codebase whose layers hand back `readonly T[]` had the producer
  view sitting in the file it was already importing and no way to name it. Its own docblock had said
  the right thing since it was written: _"Mutability is not a fact about a wire shape."_ Measured on
  one service: 2 contract methods returning `readonly T[]` and 35 readonly array properties, none of
  them expressible against the published shape.

- **`unmirrorable-seal`**, a new refusal. `seal-object-schemas` is settable per service, and
  `@typespec/openapi3` has no per-service options - it applies one value to the whole program. So
  services that seal differently cannot both be mirrored, and one of them would publish a document
  that disagrees with the validator emitted beside it. That is the exact disagreement the option's
  own docblock warns about, and it was previously accepted without a word.

### Documented

- **`Exact<>`'s docblock claimed it narrows the inferred type to match "the contract". It does
  not**, and that false claim sent a consumer looking for a bug that is not there. The contract types
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
  (microsoft/TypeScript#15300), so whether a consumer could satisfy a published shape came to depend
  on which keyword their own types happened to use. Measured on one service: 58 of 101 components
  open, 26 of those nesting another open component, so satisfying it meant a structural deep copy of
  the response tree per response, and a single spread reached only the outermost level.

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
handled it correctly either way; the fixture simply did not say so, which is how the consumer half of
the same fix shipped broken.

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

Reported as a header/`Record` interaction; measured, the header is incidental and the trigger is a
`Record` body beside any other input.

## [0.14.0] - 2026-08-14

A minor: every response arm now carries its media types, including where there is only one.

`contentTypes` was emitted only where a status offered several, on the reasoning that one type is
what an application already assumes. That reasoning assumed the one type is JSON. A `text/plain` arm
and a JSON arm were therefore indistinguishable to a generic `deps.respond` - the document knew and
the runtime did not - so consumers restated the media type in their own result envelope to get it
back. Reported by a consumer who could then delete that code.

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

**What settled it was a consumer's workaround.** They rewrote `utcDateTime` as `string` with a
`@pattern` to get the check, which lost `format: date-time` from their document AND gave a weaker
check, since a hand-written pattern accepts `2026-02-31`. A rule that pushes consumers into writing
worse specs is the wrong rule.

**`{ offset: true }` was measured, and the old comment's warning was right.** A bare
`z.iso.datetime()` rejects `2026-08-14T12:00:00+01:00`, which the document permits, so it would have
refused conformant callers. With the offset permitted every legal instant is accepted and only
`2026-02-31` and `banana` are refused.

### `@format` on a plain string is still not enforced

That half is unchanged and is the other side of the same principle: a type is a claim about the
value, an annotation is a hint about it. Enforcing an author's `@format("uuid")` would add a rule the
contract does not state, and `@format("account-number")` proves no general rule exists.

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
