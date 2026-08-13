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
npm install typespec-http-zod
```

⚠️ **A regular dependency, not a dev one, if your application calls `armFor`.** The emitter itself
runs at build time, and the generated files import only `import type { ResponseArm }` — a type, which
erases. But [`./runtime`](#answering-a-request) also exports `armFor`, a **function**, and it exists
precisely so applications do not re-derive OpenAPI's response precedence by hand. An application that
calls it and installed this package with `--save-dev` typechecks, builds, and runs in development,
then fails on deploy:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'typespec-http-zod'
    imported from dist/server.js
```

Measured in a fresh project installed from a `pnpm pack` tarball: identical build output, `pnpm
install --prod`, **exit 1**; the same bytes with the package in `dependencies`, **exit 0**. If you use
only the emitted validators and never import `armFor`, `--save-dev` is sufficient.

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
```

## What it emits

⚠️ **Only `schemas.gen.ts` is emitted by the configuration above.** The other three are written only
when `contracts-output-dir` names somewhere to put them — they are the framework-free contract types
and the assertions that pair them against the validators, and a consumer that wants validators alone
should not have them appear uninvited. Add it to get all four:

```yaml
# tspconfig.yaml
emit:
  - typespec-http-zod
options:
  typespec-http-zod:
    emitter-output-dir: "{project-root}/src/generated"
    contracts-output-dir: "{project-root}/src/generated"
```

| file                   | what it is                                                                                                                                           | emitted when                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `schemas.gen.ts`       | every validator: the component schemas, **and** each operation's path, query, header, body and response validators, plus the arms it may answer with | always                           |
| `requests.gen.ts`      | framework-free contract types — plain TypeScript, no imports, so they cross layers that must not see a validation library                            | `contracts-output-dir` is set    |
| `vocabularies.gen.ts`  | each enum's members as a runtime tuple, because a generated type cannot be iterated                                                                  | `contracts-output-dir` is set    |
| `wire-contract.gen.ts` | assertions pairing the emitted Zod against those types, so the two walks cannot disagree silently                                                    | that **and** `contracts-package` |

Per operation you get `readWidgetPath`, `readWidgetQuery`, `readWidgetHeader`, `readWidgetBody`,
`readWidgetResponse` and `readWidgetResponses` — named from **the operation id the document
publishes**, which is not always the bare operation name.

⚠️ **An operation inside a namespace is named after the whole id.** `op readWidget` inside
`namespace Widgets` has operation id `Widgets_readWidget`, so the identifiers are
`Widgets_readWidgetPath` and so on. Namespaces are the idiomatic way to group routes, so this is the
common case rather than the exception — read the emitted file for the names rather than assuming
them.

⚠️ **A validator that is already a component gets no second name.** `readWidgetResponse` is emitted
only when the response shape needs a name of its own; where the operation answers with a declared
model the arm refers to that model's schema directly — `widgetSchema`, not `readWidgetResponse`. The
same holds for a request body: `op createWidget(@body body: WidgetCreate)` is validated by
`widgetCreateSchema`. The mapping from an operation to the schema that validates it is published
through the [API](#building-an-emitter-on-this) as `EmittedService.schemaNames`; from the emitted file
alone, an operation with no `…Body` const is one whose body is a named component.

## Options

| option                 | what it does                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seal-object-schemas`  | whether a model closed in the spec REJECTS an undeclared property rather than stripping it. ⚠️ **Set this to whatever `@typespec/openapi3`'s option of the same name is set to** — the two emitters answer the same question about the same models and neither can read the other's configuration. Defaults to `false`, which is openapi3's default. |
| `contracts-output-dir` | where the framework-free contract types go, when they should not sit beside the validators. Omitted, they are not emitted.                                                                                                                                                                                                                           |
| `contracts-package`    | the specifier the emitted Zod imports shared types from. **No default** — it once defaulted to one repository's package name, so a consumer who configured nothing got validators importing from a package they had never heard of. With none named, enums are emitted inline and the output depends on nothing.                                     |
| `key-vocabularies`     | models whose PROPERTY NAMES are also emitted as a runtime tuple. For a closed key set that is a contract fact but cannot be a `Record` key type. A name matching no model is reported, not ignored.                                                                                                                                                  |
| `runtime-module`       | where the generated files import `ResponseArm` from. Defaults to `typespec-http-zod/runtime`.                                                                                                                                                                                                                                                        |
| `services`             | per-`@service` overrides, keyed by namespace name, for a spec that publishes more than one surface.                                                                                                                                                                                                                                                  |

## Answering a request

No server framework appears below, because none is needed: the emitted validators are plain Zod and
`./runtime` is two exports. Express, Fastify, Elysia or a bare `fetch` handler each supply the
`params`/`query`/`body` this reads.

```ts
import { armFor, type ResponseArm } from "typespec-http-zod/runtime";
import { Widgets_readWidgetPath, Widgets_readWidgetResponses } from "./generated/schemas.gen.js";

/** Answer a status with a body the document says that status carries. */
function respond(arms: readonly ResponseArm[], status: number, body: unknown) {
	const arm = armFor(arms, status);
	if (arm === undefined) throw new Error(`no declared arm for ${status}`);
	return { status, body: arm.schema === undefined ? undefined : arm.schema.parse(body) };
}

export function readWidget(params: Record<string, unknown>, widget: unknown | undefined) {
	const parsed = Widgets_readWidgetPath.safeParse(params);
	if (!parsed.success) return { status: 400, body: parsed.error.issues };
	return widget === undefined
		? respond(Widgets_readWidgetResponses, 404, { code: "not_found", message: "no such widget" })
		: respond(Widgets_readWidgetResponses, 200, widget);
}
```

**`armFor` is the whole reason `./runtime` exists.** An operation can declare `404`, `4XX` and
`default` at once and all three describe a 404. OpenAPI settles it — an explicit code beats a range,
and `default` is every status not otherwise listed — and a package that emits arms containing `4XX`
and `default` without shipping the rule for reading them has shipped a footgun. Measured against the
arms emitted for such an operation:

| answered | arm chosen | body validated against |
| -------- | ---------- | ---------------------- |
| `200`    | `200`      | the success model      |
| `404`    | `404`      | `NotFound`             |
| `429`    | `4XX`      | `Throttled`            |
| `500`    | `default`  | `Unexpected`           |

⚠️ **A path or query value is a string on the wire, and the emitted validators already know.** A
parameter the document types as `integer` is emitted wrapped in a `z.preprocess` that decodes `"1"`
to `1` — and **decodes rather than coerces**, so `?limit=` stays empty and fails the schema instead of
arriving as `0`. A flattened list (`?tags=a,b,c`) is split on the delimiter the document's `style`
implies before the array schema runs. Hand the raw values straight in; do not pre-parse them.

## Building an emitter on this

The exported API — `emitHttpZod`, `EmittedService`, `EmittedRoute`, `collectRoutes` and the rest — is
what an emitter for another framework calls. `emitHttpZod` returns one `EmittedService` per
`@service`, and `EmittedService.schemaNames` maps each operation id to the identifiers its validators
were declared under, so a wrapping emitter imports names rather than agreeing about them.

```ts
const services = await emitHttpZod(context, { defaultRuntimeModule: "my-emitter/runtime" });
for (const service of services) {
	for (const route of service.routes) {
		const names = service.schemaNames.get(route.operationId);
		// names.path / names.query / names.header / names.body / names.response / names.responses
	}
}
```

⚠️ **`defaultRuntimeModule` is a default, not an override** — a consumer's `runtime-module` still
wins. It exists so a wrapping emitter whose generated files import more than `ResponseArm` can point
them at its own module.

## What it refuses, and why

Every refusal is a **diagnostic**, not a thrown error: it points at the offending declaration, carries
a code you can search for, and does not stop the walk — so one compile names every problem rather
than the first.

| code                            | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsupported-scalar`            | a scalar with no known base and no `@encode`. Give it `extends`, or encode it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `unsupported-type`              | a construct with no runtime representation — `never` is the reachable case.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `unsupported-default`           | a default with no literal form — a scalar CONSTRUCTOR call such as `utcDateTime.fromISO(...)`. Scalars, arrays and objects, nested to any depth, are emitted as literals. The property keeps its declared shape and loses only the fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `empty-union`                   | a union with no representable variants has nothing to validate against.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `unknown-key-vocabulary`        | a `key-vocabularies` entry naming no model. Reported because the failure mode is silence: a missing vocabulary looks exactly like an empty one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `unsupported-status-code-range` | OpenAPI keys a range as `1XX`…`5XX`, so `@minValue(494) @maxValue(499)` has nowhere to go. ⚠️ **Refused because `@typespec/openapi3` refuses it**, with the same rule copied from its source. A range covering a bucket exactly — `@minValue(400) @maxValue(499)` — is supported.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `undeclared-discriminator`      | ⚠️ **Upstream, and not something you can fix with an emitter option.** `@discriminated(#{envelope: "none"})` puts the discriminator inside each variant on the wire, and openapi3 emits `oneOf` with a `discriminator` keyword while never adding that property to the variant schema — which OpenAPI 3.1 forbids ("the `discriminator` field MUST be a required field"). Tracked as [`microsoft/typespec#7141`](https://github.com/microsoft/typespec/issues/7141), open and maintainer-filed. **It is avoidable in your spec**: declare the discriminator on the variant (`model Cat { kind: "cat"; … }`) and openapi3 publishes it as required, with no divergence and no refusal. |

## Known limits

Stated here rather than left as numbers in a baseline file, because a number in a baseline is not a
stated limitation once a package is published. Each is re-measured by the suite.

- **`format` is deliberately not enforced, and that is now CHECKED rather than counted.** Under JSON
  Schema 2020-12 `format` is an annotation, not a validation keyword, so turning one into a check
  would enforce something the document does not assert. 142 annotations go unenforced, and
  `test/vocabulary.test.ts` refuses any format-derived Zod call as a class — so turning it on breaks a
  test rather than moving a number.
- **4 negotiated response bodies cannot be attributed to a single arm.** OpenAPI lists one
  body per media type against members that each carry their own, so there is no one arm to compare
  them to. The status-to-body mapping is still graded for them.
- **4 response bodies reduce to no readable kind on one side** — a stream, or a union. Counted, never
  silently passed.
- **A `@head` operation gets validators here and cannot be served by every router.** That is a fact
  about the server, not about this package — see `typespec-hono`, which refuses it and says why.
- **`int64` and `uint64` are validated as JavaScript numbers, so values above `2^53-1` are refused —
  and `@encode(string)` is the fix.** The document publishes `type: integer` with `format: int64`,
  which states no bound; the emitted `z.number().int()` refuses anything beyond
  `Number.MAX_SAFE_INTEGER`. That is a constraint the document does not state, and it is kept anyway,
  because it is imposed by the runtime rather than invented here — **above `2^53-1` an integer is no
  longer uniquely representable as a JavaScript number**, so a validator cannot certify that the value
  it holds is the value that was sent. Measured: `9007199254740993` reaches a handler as
  `9007199254740992`, and int64's maximum as `9223372036854776000`, both through `JSON.parse` before
  any validator runs. Accepting them would stamp "valid" on a number nobody sent, which is the one
  answer a validator must never give. `z.int64()` is not an alternative: it is `bigint`-based and
  `JSON.parse` never produces a `bigint`, so it would refuse every JSON body.

  ⚠️ **TypeSpec's own remedy works and costs one decorator.** `@encode(string) value: int64` emits
  `z.string()`, and openapi3 publishes `type: string` with `format: int64` — the two agree exactly, and
  the digits survive the wire intact. Use it for any 64-bit integer whose values can exceed `2^53-1`:
  identifiers, balances in minor units, timestamps in nanoseconds.

- **The emitted output requires `zod`, not `zod/mini`.** The tree-shakeable variant has no chained
  methods at all — measured on 4.4.3, `typeof z.string().optional`, `.nullable` and `.min` are each
  `undefined` — and the emitted validators use `.optional()`, `.nullable()`, `.default()`, `.strict()`,
  `.loose()` and `.catchall()`. A browser or Workers consumer therefore pays for the full `zod` build.
  This is a property of the emitted spelling rather than of the schemas, so it is fixable; it is
  recorded here as a measured fact rather than a plan.

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
