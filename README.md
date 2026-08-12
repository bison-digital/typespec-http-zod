# typespec-http-zod

Zod validators and framework-free contract types from a TypeSpec HTTP service — agreeing, keyword for
keyword, with the OpenAPI document [`@typespec/openapi3`](https://typespec.io) publishes from the same
source.

It is a **library and an emitter**. Use the emitter to generate validators for any server — Express,
Fastify, Elysia, a Workers fetch handler, a typed client — or use the API to build an emitter of your
own. [`typespec-hono`](https://github.com/bison-digital/typespec-hono) is the second kind, and is
where the API is proved.

## The governing rule

**If the document cannot say it, the validator must not enforce it.**

A validator that checks something the published contract never states is a rule no caller reading that
contract can see. This package ships **zero decorators** for exactly that reason — four once existed,
and every one let a spec state something `@typespec/openapi3` could not publish — and asserts the
class is empty rather than trusting it. Where openapi3 decides something, its rule is read from its
source and copied, refusals included: the same spec has to be representable by both emitters or by
neither, or a differential between them means nothing.

## Install

```bash
npm install --save-dev typespec-http-zod
```

Peers: `@typespec/compiler`, `@typespec/http`, `@typespec/openapi`, and `zod` (the generated output
imports it). `@typespec/versioning` and `@typespec/streams` are **optional** — they are resolved
behind a guarded `import()`, so a spec declaring neither needs neither.

```yaml
# tspconfig.yaml
emit:
  - typespec-http-zod
options:
  typespec-http-zod:
    emitter-output-dir: "{project-root}/src/generated"
    seal-object-schemas: true
```

## What it emits

| file                   | what it is                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemas.gen.ts`       | every validator: the component schemas, **and** each operation's path, query, header, body and response validators, plus the arms it may answer with |
| `requests.gen.ts`      | framework-free contract types — plain TypeScript, no imports, so they cross layers that must not see a validation library                            |
| `vocabularies.gen.ts`  | each enum's members as a runtime tuple, because a generated type cannot be iterated                                                                  |
| `wire-contract.gen.ts` | assertions pairing the emitted Zod against those types, so the two walks cannot disagree silently                                                    |

Per operation you get `readWidgetPath`, `readWidgetQuery`, `readWidgetHeader`, `readWidgetBody`,
`readWidgetResponse` and `readWidgetResponses` — named from the operation id the document publishes.

## Options

| option                 | what it does                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seal-object-schemas`  | whether a model closed in the spec REJECTS an undeclared property rather than stripping it. ⚠️ **Set this to whatever `@typespec/openapi3`'s option of the same name is set to** — the two emitters answer the same question about the same models and neither can read the other's configuration. Defaults to `false`, which is openapi3's default. |
| `contracts-output-dir` | where the framework-free contract types go, when they should not sit beside the validators. Omitted, they are not emitted.                                                                                                                                                                                                                           |
| `contracts-package`    | the specifier the emitted Zod imports shared types from. **No default** — it once defaulted to one repository's package name, so a consumer who configured nothing got validators importing from a package they had never heard of. With none named, enums are emitted inline and the output depends on nothing.                                     |
| `key-vocabularies`     | models whose PROPERTY NAMES are also emitted as a runtime tuple. For a closed key set that is a contract fact but cannot be a `Record` key type. A name matching no model is reported, not ignored.                                                                                                                                                  |
| `runtime-module`       | where the generated files import `ResponseArm` from. Defaults to `typespec-http-zod/runtime`.                                                                                                                                                                                                                                                        |
| `services`             | per-`@service` overrides, keyed by namespace name, for a spec that publishes more than one surface.                                                                                                                                                                                                                                                  |

## What it refuses, and why

Every refusal is a **diagnostic**, not a thrown error: it points at the offending declaration, carries
a code you can search for, and does not stop the walk — so one compile names every problem rather
than the first.

| code                            | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsupported-scalar`            | a scalar with no known base and no `@encode`. Give it `extends`, or encode it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `unsupported-type`              | a construct with no runtime representation — `never` is the reachable case.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `unsupported-default`           | a default value that is neither a scalar nor an empty collection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `empty-union`                   | a union with no representable variants has nothing to validate against.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `circular-model`                | a cycle closing through a union variant or dictionary value, neither of which is a property a getter can sit on. Ordinary recursion through a model property is fully supported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `unknown-key-vocabulary`        | a `key-vocabularies` entry naming no model. Reported because the failure mode is silence: a missing vocabulary looks exactly like an empty one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `unsupported-status-code-range` | OpenAPI keys a range as `1XX`…`5XX`, so `@minValue(494) @maxValue(499)` has nowhere to go. ⚠️ **Refused because `@typespec/openapi3` refuses it**, with the same rule copied from its source. A range covering a bucket exactly — `@minValue(400) @maxValue(499)` — is supported.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `undeclared-discriminator`      | ⚠️ **Upstream, and not something you can fix with an emitter option.** `@discriminated(#{envelope: "none"})` puts the discriminator inside each variant on the wire, and openapi3 emits `oneOf` with a `discriminator` keyword while never adding that property to the variant schema — which OpenAPI 3.1 forbids ("the `discriminator` field MUST be a required field"). Tracked as [`microsoft/typespec#7141`](https://github.com/microsoft/typespec/issues/7141), open and maintainer-filed. **It is avoidable in your spec**: declare the discriminator on the variant (`model Cat { kind: "cat"; … }`) and openapi3 publishes it as required, with no divergence and no refusal. |

## Known limits

Stated here rather than left as numbers in a baseline file, because a number in a baseline is not a
stated limitation once a package is published. Each is re-measured by the suite.

- **`format` is deliberately not enforced, and that is now CHECKED rather than counted.** Under JSON
  Schema 2020-12 `format` is an annotation, not a validation keyword, so turning one into a check
  would enforce something the document does not assert. 136 annotations go unenforced, and
  `test/vocabulary.test.ts` refuses any format-derived Zod call as a class — so turning it on breaks a
  test rather than moving a number.
- **4 negotiated response bodies cannot be attributed to a single arm.** OpenAPI lists one
  body per media type against members that each carry their own, so there is no one arm to compare
  them to. The status-to-body mapping is still graded for them.
- **4 response bodies reduce to no readable kind on one side** — a stream, or a union. Counted, never
  silently passed.
- **A `@head` operation gets validators here and cannot be served by every router.** That is a fact
  about the server, not about this package — see `typespec-hono`, which refuses it and says why.

## How it is graded

Nothing here is judged by fixtures we wrote alone.

- **Conformance differential** — both emitters run from ONE compile of
  [`@typespec/http-specs`](https://www.npmjs.com/package/@typespec/http-specs), Microsoft's own
  scenario corpus, and the assertion is that the validators say what the document says. Components,
  request parameters, declared statuses and response bodies. **0 divergences.**
- **Round-trip against APIs nobody here designed** — the OpenAPI Initiative's teaching example and the
  Swagger Petstore, converted to TypeSpec and compiled back out, then compared against the originals.
  **22 operations, none lost, no shape disagreements.** Every other suite measures this emitter
  against material that already knows about it; this one asks what a first adopter asks. The
  documents are vendored with digests the suite asserts, never fetched.
- **Request bodies are compared, and were compared by nothing at all** — 21 by shape and 36 by kind. Parameters were graded and responses were graded; what a caller may SEND, the largest surface of most APIs, had no arm.
- **Response bodies are compared, not counted** — 24 inline bodies by SHAPE and
  44 non-object bodies by KIND. This surface was a bare number for a long time, and closing it
  immediately found three positions where the emitter required a string for a raw binary body the
  document says nothing about.
- **`content-type` and `accept` are compared** against the `content` keys that state them — 77
  positions, no divergences. OpenAPI declares media types through `requestBody.content` and each
  response's `content` rather than as parameters, so the parameter arm sets these aside; a separate
  arm compares them where the document actually puts them.
- **Depth fixtures** for what a protocol corpus does not contain: it declares **no constraints at
  all**, so `test/reference/constraints.tsp` exercises every constraint keyword once, on the type it
  is legal on.
- **Every counting arm has a non-vacuity floor.** An arm that stops firing otherwise reports agreement
  about nothing, which has happened here and is why the floors exist.
- **The emitted output is compiled** by the real compiler under `strict` and
  `exactOptionalPropertyTypes`, because "it emitted" is not "it works".
- **The package is packed and its tarball inspected**, because `files` is a set of globs and a glob
  that stops matching is indistinguishable from one that matches nothing.

## Licence

MIT
