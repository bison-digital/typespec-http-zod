# Changelog

All notable changes to `typespec-http-zod` are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

⚠️ **At `0.x` the public API is not frozen.** A minor bump may change the emitted output or the
published types; a patch will not. The **emitted output is part of the API** — a change to a
validator's shape, to a declared identifier, or to the `EmittedRoute` a wrapping emitter reads is a
change a consumer feels, and is treated as such here rather than as an implementation detail.

## [Unreleased]

Nothing since `0.1.0`.

## [0.1.0] — 2026-08-13

First release.

### Added

- **The emitter.** A TypeSpec HTTP service becomes `schemas.gen.ts` — every component validator, and
  each operation's path, query, header, body and response validators, plus the `ResponseArm[]` it may
  answer with. With `contracts-output-dir` set it also emits `requests.gen.ts` (framework-free
  contract types, no imports), `vocabularies.gen.ts` (each enum as a runtime tuple), and — with
  `contracts-package` — `wire-contract.gen.ts`, which asserts the emitted Zod infers exactly those
  types so the two walks cannot disagree silently.
- **The library.** `emitHttpZod`, `collectRoutes`, `EmittedService`, `EmittedRoute`,
  `RouteSchemaNames`, `StatusKey`, `successStatusOf`, `successStatusesOf`, `errorBodyOf`,
  `isRawBinaryMediaType`, `objectKey`, `EmitterOptionsSchema`, `DEFAULT_RUNTIME_MODULE` and `$lib` —
  what an emitter for another framework calls. `typespec-hono` is built on it.
- **`./runtime`** — `ResponseArm` and `armFor`, the latter applying OpenAPI's own response precedence
  so an application does not re-derive it. Deliberately free of every TypeSpec import, so an
  application never pulls the compiler into its runtime graph.
- **Options** — `seal-object-schemas`, `contracts-output-dir`, `contracts-package`,
  `key-vocabularies`, `runtime-module`, and per-`@service` overrides via `services`.

### Notes for a first adopter

- **Install as a regular dependency if you call `armFor`.** It is a function, so `--save-dev`
  typechecks, builds and runs in development and then fails on deploy with `ERR_MODULE_NOT_FOUND`. If
  you use only the emitted validators, `--save-dev` is sufficient.
- **Set `seal-object-schemas` to whatever `@typespec/openapi3`'s option of the same name is set to.**
  Neither emitter can read the other's configuration, and they answer the same question about the same
  models.
- **The emitted output requires `zod`, not `zod/mini`** — the tree-shakeable variant has no chained
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
