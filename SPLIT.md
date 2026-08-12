# Splitting `typespec-hono` into two packages

Working plan. Written 2026-08-12 from a measurement of the un-split package at
`company-manager@6587fd7`, `packages/typespec-hono`.

## Why two

Measured, after an earlier claim in the other direction was found to be made up:

- **One file of ten imports Hono: `runtime.ts`, 256 lines of 4,727 — 5%.** The two `hono` imports in
  `index.ts` are inside an emitted template literal, not real imports.
- `zod.ts`, `registry.ts`, `types.ts`, `constraints.ts`, `versioning.ts`, `streams.ts` and `lib.ts`
  are 2,368 lines with no Hono at all. `index.ts` (2,093) is the only genuinely mixed file.
- The audience for **TypeSpec → Zod validators** — Express, Fastify, Elysia, plain Workers, typed
  clients — is strictly larger than the audience for a Hono server generator.

⚠️ **The `@typespec/openapi3` precedent does NOT argue against this, and it was cited as though it
did.** openapi3 keeps its schema emitters internal because they emit *OpenAPI schema objects*, which
are meaningless outside an OpenAPI document. This emits *runtime validators*, useful in any server.
The thing openapi3 does factor out — `@typespec/asset-emitter` — is precisely the part with value
beyond one emitter. Read properly, it argues for the split.

## The shape, and the one hard problem

⚠️ **The two halves share live in-memory state and a naming contract.** `renderApp` calls
`registry.expressionFor(body)` and `namedSchema(operationId, …)`, and the generated server imports
`widgetSchema` / `getWidgetPath` **by name** from `schemas.gen.js`. If both halves were separate
TypeSpec **emitters**, each would get its own `$onEmit` and its own registry, and they would have to
arrive at identical identifiers by coincidence.

**So:**

- `typespec-http-zod` ships a **library API _and_ its own emitter**. Usable standalone by anyone who
  wants validators and types with no server.
- `typespec-hono` is an **emitter that imports the library**. A consumer lists ONE emitter.

The price, paid deliberately: the library's API is public and frozen at v0.

## The seam

Everything below is a top-level declaration of the un-split `index.ts` unless noted.

### `typespec-http-zod` — the library

**Public API the Hono package consumes:**

| export                                                            | why it is public                                 |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| `collectRoutes(program, registry, service) → EmittedRoute[]`      | **the shared intermediate representation**       |
| `EmittedRoute`, `StatusKey`                                       | its type                                         |
| `SchemaRegistry` — `expressionFor`, `declarations`                | identifier naming; the coupling above            |
| `namedSchema`, `schemaConst`, `isIdentifier`                      | how a per-route validator gets its name          |
| `renderSchemas`, `renderRequestTypes`, `renderVocabularies`, `renderWireAssertions` | the artefacts, so Hono re-emits none of them |
| `renderExternalImports`, `collectExternalImports`                 | import collection during a walk                  |
| `withContractsPackage`, `withSealedObjects`, `withVisibility`     | scoped emission settings                         |
| `serviceSnapshots`, `resolveVersioningModule`                     | which service/version is emitted                 |
| the option types for `seal-object-schemas`, `contracts-*`, `key-vocabularies` | so Hono forwards rather than restates |

**Internal:** `zod.ts`, `registry.ts`, `constraints.ts`, `types.ts`, `versioning.ts`, `streams.ts`,
and from `index.ts`: `errorBodyOf`, `bodyTypeOf`, `successBodyOf`, `multipartSchemaOf`,
`isBinaryPart`, `requestBodyOf`, `isArrayType`, `parameterSchemasOf`, `parametersSchemaOf`,
`COLLECTION_DELIMITERS`, `isCollectionParameter`, `collectionDelimiterOf`, `statusKeysOf`,
`isSuccessKey`, `errorArmsOf`, `statusPrecedenceOf`, `bodySchemaOf`, `successStatusesOf`,
`successStatusOf`, `statusDiscriminatorOf`, `alternateSchemaFor`, `responseContentTypesOf`,
`noAuthFor`, `collectRequestTypes`, `collectResponseTypes`, `upperFirst`, `indent`.

**Diagnostics:** `unsupported-scalar`, `unsupported-type`, `unsupported-default`,
`undeclared-discriminator`, `empty-union`, `circular-model`, `unknown-key-vocabulary`.

### `typespec-hono` — the server emitter

`runtime.ts` entire, and from `index.ts`: `toHonoPath`, `PLAIN_PATH_PARAMETER`, `HONO_METHOD`,
`renderApp`, `AppRoute`, `inputTypeOf`, `capitaliseId`, `responseArmsOf`, and the emitted
`Operations` / `Exhaustive` / `registerRoutes` text.

**Diagnostics:** `unsupported-path-template`, `unsupported-status-code-range`.

⚠️ `renderRoutes` and everything it emits — `GeneratedRoute`, `GENERATED_ROUTES`,
`GENERATED_ERROR_SCHEMA`, `GeneratedOperationId` — is the **old route table**, already scheduled for
deletion (G2.5, blocked on company-manager moving off it). **Do not carry it across.** Splitting is
the moment to drop it, and doing so removes `renderRoutes` (104 lines) plus the `EmittedRoute` fields
that exist only to feed an interpreter: `pathParams`, `headerParams`, `rawBodyProperty`, `noAuth`,
`statusBy`.

### `lib.ts` splits in two

Each package needs its own `$lib` — TypeSpec allows one per library. `reportDiagnostic` is imported
by `zod.ts`, `constraints.ts` and `registry.ts`, which all go to the library, so the library keeps
the bulk. Neither `$lib` has a `state` key: **there are no decorators in either package**, and
`test/vocabulary.test.ts` asserts that as a class.

## What each package has to prove on its own

Both need their own gold standard. The oracles do **not** divide cleanly, and pretending they do is
how one half ends up ungraded.

| oracle                   | goes to                | note                                                              |
| ------------------------ | ---------------------- | ----------------------------------------------------------------- |
| conformance differential | **split**              | components, parameters and response BODIES are the library's; route paths, mounted-route counts and response ARMS need the Hono emitter |
| round-trip               | library                | it compares documents and components                              |
| Hono equivalence         | Hono                   | `reference-app.ts` is written in `@hono/zod-openapi`'s idiom      |
| wiring                   | Hono                   | needs a running server                                            |
| vocabulary (Zod calls)   | **both**               | each asserts its own emitted output                                |
| packaging                | **both**               | each declares its own peers                                       |

⚠️ **The library needs a differential of its own, and it cannot be the current one unchanged.** The
current one imports `app.gen.ts` and mounts a real Hono app to count routes. The library's version
must grade `components.schemas` and `document.paths` parameters without that — and must keep its
non-vacuity floors, or the split silently halves the coverage that took this long to build.

## Order of work

1. Library first, standing alone: move files, split `lib.ts`, split `index.ts`, its own emitter entry.
2. Its full suite, with floors, green — **before** the Hono package exists to lean on.
3. Hono package against the published library API. Drop the route table here.
4. Its full suite green.
5. **Then** integrate: company-manager depends on both, regenerates, whole gate green. Only that step
   tells us whether the API drawn above is the right one.

⚠️ Nothing is published until step 5 passes. Publishing is public and permanent.

## Known unknowns

- Whether `EmittedRoute` is the right IR, or whether the Hono emitter wants the `HttpOperation` and
  the registry directly. Step 5 answers it; drawing the API before step 3 would be guessing.
- Whether option forwarding stays honest. The Hono emitter's option schema should be **derived** from
  the library's, not restated — two schemas that must agree are two lists that will not.
- `versioning.ts` decides which operations exist at all, so both halves care. It sits in the library
  and the Hono emitter consumes its result via `collectRoutes`; if that proves wrong, it is the first
  thing to revisit.
