# Reference

Every option, every diagnostic, and the limits of what this emitter enforces.

## Options

Set under `options.typespec-http-zod` in `tspconfig.yaml`.

| option                 | what it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seal-object-schemas`  | Whether a model closed in the spec rejects an undeclared property rather than stripping it. Set this to whatever `@typespec/openapi3`'s option of the same name is set to: the two emitters answer the same question and neither can read the other's configuration. Defaults to `false`, which is openapi3's default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `compile-schemas`      | Whether every emitted validator is wrapped in `z.compile()`, Zod 4.5's ahead-of-time compiler. Parsing the same values to the same results, faster: measured on an emitted five-property model at zod 4.5.2, `safeParse` goes from 371 ns to 51 ns. Defaults to `false`, because it is a trade - compilation runs at module scope and costs roughly 3 ms per 25 declarations, and it needs `new Function`, which a CSP or no-eval environment refuses (Zod degrades to the uncompiled schema there rather than throwing). On Cloudflare Workers this is the only route to a compiled schema, measured on `workerd` rather than read off a page: with this option a probe of the emitted schema reports a compiled fast path, and with Zod's own `import "zod/compile"` it reports none either side of the first parse - global mode compiles lazily, and that first parse happens inside a request, where `new Function` is refused. `new Function` IS permitted during a Worker's startup phase, which is when module scope runs. |
| `contracts-output-dir` | Where the framework-free contract types are written. Omitted, they are not emitted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `contracts-package`    | The specifier the emitted Zod imports shared types from. No default. With none named, enums are emitted inline and the output depends on nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `key-vocabularies`     | Models whose property names are also emitted as a runtime tuple, for a closed key set that cannot be a `Record` key type. A name matching no model is reported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `runtime-module`       | Where the generated files import `ResponseArm` from. Defaults to `typespec-http-zod/runtime`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `regenerate-hint`      | The command that regenerates these files, written into every banner. `DO NOT EDIT` says what not to do and not what to do instead, and only the project knows whether that is `pnpm generate` or a `tsp compile` with three flags. Omitted, a generic line is kept. Settable per service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `services`             | Per-`@service` overrides, keyed by namespace name, for a spec publishing more than one surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## What it refuses, and why

Every refusal is a diagnostic. It points at the offending declaration, carries a code you can search
for, and does not stop the walk, so one compile names every problem rather than the first.

One of them is a **warning** rather than an error, and the distinction is worth stating.
`default-on-required-property` names a spec `@typespec/openapi3` emits happily, so refusing it would
make the same spec representable by one emitter and not the other - the one thing a differential
between the two cannot tolerate. What is wrong with it is not that it cannot be served, but that it
does not mean what its author almost certainly intended.

| code                            | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicate-declaration`         | Two different types claim one TypeScript name. The document tells them apart by namespace and a module cannot. A REPEAT of the same declaration is not this: visibility projection hands the registry a distinct type object for one model, and those are collapsed silently.                                                                                                                                                                                                               |
| `duplicate-operation-id`        | An explicit `@operationId` another operation already answers to. OpenAPI requires the id to be unique, and an explicit one is never renamed to make room, so it cannot be resolved for you. Ids DERIVED from a parent container are deduplicated silently, exactly as `@typespec/openapi3` deduplicates them, and raise nothing.                                                                                                                                                            |
| `unsupported-type`              | A construct with no runtime representation. `never` in a body or a union variant is the reachable case. A `never` property is dropped instead, matching the document.                                                                                                                                                                                                                                                                                                                       |
| `unsupported-default`           | A default with no literal form, such as the scalar constructor `utcDateTime.fromISO(...)`. Scalars, arrays and objects nested to any depth are emitted as literals. The property keeps its declared shape and loses only the fallback.                                                                                                                                                                                                                                                      |
| `default-on-required-property`  | **A warning.** A default on a property the document publishes as `required`, where it can never apply, because a required property is never absent. `default` is an annotation under JSON Schema 2020-12 and `required` is the assertion; `@typespec/openapi3` builds `required` without ever consulting a default. So the validator requires the property and carries no fallback, exactly as the document describes it. Declare the property optional if callers may omit it.             |
| `empty-union`                   | A union with no representable variants has nothing to validate against. `@typespec/openapi3` raises its own error for the same spec and writes no document.                                                                                                                                                                                                                                                                                                                                 |
| `unknown-key-vocabulary`        | A `key-vocabularies` entry naming no model in the service. This is a configuration error rather than a limit of the spec, reported because the failure mode is silence: a missing vocabulary looks exactly like an empty one.                                                                                                                                                                                                                                                               |
| `unsupported-status-code-range` | OpenAPI keys a range as `1XX` to `5XX`, so `@minValue(494) @maxValue(499)` has nowhere to go. `@typespec/openapi3` refuses the same spec and writes no document, so the same rule is copied from its source. A range covering a bucket exactly, `@minValue(400) @maxValue(499)`, is supported.                                                                                                                                                                                              |
| `unmirrorable-seal`             | Two services resolve `seal-object-schemas` differently. `@typespec/openapi3` has no per-service options and applies one value to the whole program, so one of them would publish a document that disagrees with the validator emitted beside it - sealed here and silent there refuses a payload the document permits, and the reverse publishes a strictness the runtime does not enforce. Give every service the same value, or split the surfaces into separate compiles.                |
| `undeclared-discriminator`      | Upstream, and not fixable with an emitter option. `@discriminated(#{envelope: "none"})` puts the discriminator inside each variant on the wire, and openapi3 emits `oneOf` with a `discriminator` keyword while never adding that property to the variant schema, which OpenAPI 3.1 forbids. Tracked as [microsoft/typespec#7141](https://github.com/microsoft/typespec/issues/7141). Avoidable in your spec by declaring the discriminator on the variant, as `model Cat { kind: "cat" }`. |

## Known limits

- **`format` is not enforced.** Under JSON Schema 2020-12 `format` is an annotation rather than a
  validation keyword, so turning one into a check would enforce something the document does not
  assert. 145 annotations go unenforced across the conformance corpus.
- **4 negotiated response bodies cannot be attributed to a single arm.** OpenAPI lists one body per
  media type against members that each carry their own, so there is no single arm to compare them to.
  The status-to-body mapping is still checked.
- **4 response bodies reduce to no readable kind on one side**, being a stream or a union.
- **A reserved path parameter is carried in the route record and not in the document, which is the
  one place this IR deliberately says more than OpenAPI can.** `@route("/vault/{+path}")` states RFC
  6570 reserved expansion: the parameter matches across `/`, so `GET /vault/areas/health.md` reaches
  one operation. OpenAPI has no way to express that at **any** version - measured at 3.0.0, 3.1.0 and
  3.2.0 - so `@typespec/openapi3` publishes `/vault/{path}` and raises `path-reserved-expansion` as a
  warning, which a consumer suppresses per-operation. `EmittedRoute.reservedPathParameters` carries
  the wire names so a server emitter can mount a route that actually matches; without it the route is
  mounted and answers 404 to every request it was written for. This emitter raises no warning of its
  own: the divergence is the document's limit, not a compromise in the output. The same flag is set by
  `@path(#{ allowReserved: true })` on a required parameter the route template does not already name;
  naming it in both places, or marking an optional parameter, is refused by `@typespec/http` with
  `use-uri-template`.

- **A `@head` operation gets validators here and cannot be served by every router.** That is a
  property of the server rather than of this package.
- **The emitted output requires `zod`, not `zod/mini`.** The tree-shakeable variant has no chained
  methods, and the emitted validators use `.exactOptional()`, `.nullable()`, `.default()`, `.min()`,
  `.max()`, `.regex()` and `.catchall()`. (This list named `.strict()` and `.loose()` until `0.24.0`
  and had been wrong since `0.17.0`: openness is emitted as `z.strictObject` and `z.looseObject`,
  which is what Zod 4 asks for, and neither suffix appears in any emitted file.)
- **`int64` and `uint64` above `2^53-1` are refused.** Above that bound an integer is no longer
  uniquely representable as a JavaScript number, so a validator cannot certify that the value it
  holds is the value that was sent. `9007199254740993` reaches a handler as `9007199254740992`
  through `JSON.parse`, before any validator runs. Use `@encode(string)` for 64-bit integers whose
  values can exceed that bound: it emits `z.string()`, and openapi3 publishes `type: string`.

## Zod version support

**The `zod` peer range is `^4.5.0`, and the floor is a correctness bound rather than a preference.**

A length bound is counted in **code points** by JSON Schema, and Zod counted UTF-16 units until 4.5.
So `@maxLength(8) handle: string` published `maxLength: 8` and emitted `.max(8)` - the same keyword
and the same number, agreeing on every structural axis - and the two answered differently for any
input outside the BMP, in **both** directions:

| input                          | the document            | the validator, before 4.5 |
| ------------------------------ | ----------------------- | ------------------------- |
| 8 emoji against `maxLength: 8` | accepts (8 code points) | refuses (16 units)        |
| 2 emoji against `minLength: 3` | refuses (2 code points) | **accepts** (4 units)     |

The second row is a payload the contract forbids reaching a handler, which is the failure this
package exists to prevent. Inside `^4.0.0` there are resolvable versions where that is true, so the
range was advertising a claim that is false within it.

`z.iso.datetime({ offset: true })` is the same story on a smaller scale: RFC 3339 mandates seconds,
and minute precision was accepted until 4.5.

Every construct the emitter writes is verified at the floor by `test/conformance/behaviour.test.ts`,
which runs values through the emitted validator and through the document itself and requires the same
verdict - including `z.strictObject`, `z.looseObject`, `z.discriminatedUnion`, `z.preprocess`,
two-argument `z.record`, `.catchall()` and `z.lazy()`.

**An optional property is emitted `.exactOptional()`, not `.optional()`.** The document says the KEY
may be absent by leaving the property out of `required`, and nothing more; `.optional()` additionally
accepts an explicit `undefined`, which **JSON cannot carry**. So the validator was admitting a value
no conformant request can contain. `z.infer` of `.exactOptional()` is `p?: T` natively and at every
depth, which is why the `Exact<>` helper that used to strip `| undefined` back off the inferred type
is no longer emitted. `.exactOptional()` requires zod 4.3.0, which the `^4.5.0` floor covers.

The contract types in `requests.gen.ts` still publish `?: T | undefined`, deliberately: they are the
floor a PRODUCER supplies, and `{ p: undefined }` serialises identically to omitting `p`.

Nothing in the emitted output opts into 4.5's `z.compile()`, and none of its new constructs
(`z.creditCard()`, `z.properties()`, `z.deepPartial()`, `z.validate()`) is emitted: a validator says
only what the document says, and the document derives none of them.

## Compatibility

Node 22 or later. The emitter runs on the stable TypeSpec 1.x surface: `$onEmit` plus
`@typespec/http`.

## What a response arm carries

`deps.respond` receives every arm the document declares for an operation and chooses one. Beyond the
status and the body schema, an arm carries two facts the document publishes and which used to be
dropped:

| field          | when it is present                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `headers`      | the response declares `@header`. Each entry pairs the WIRE name the response must set with the `property` on the returned value the value is read from, because `@header("x-correlation-id") correlationId` differs in both |
| `contentTypes` | the status offers MORE than one media type. A single type is what an application already assumes, so repeating it on every arm would be noise                                                                               |

A response declaring neither carries neither, so "none declared" and "none carried" are the same
state rather than two an application has to tell apart.

**A redirect is an arm like any other.** An operation whose only declared response is a `302` used to
be dropped from the emitted output entirely, with no diagnostic: the status filter accepted 2xx only,
so the operation had no status and was skipped. Statuses below 400 are collected now. 4xx and 5xx stay
out, because those are error arms and a handler does not reach one by returning normally.

## What a declared type checks, and what a `format` annotation does not

A scalar a spec DECLARES is a claim about the value, and the validator checks it:

| declared                        | emitted                            | the document publishes |
| ------------------------------- | ---------------------------------- | ---------------------- |
| `utcDateTime`, `offsetDateTime` | `z.iso.datetime({ offset: true })` | `format: date-time`    |
| `plainDate`                     | `z.iso.date()`                     | `format: date`         |
| `plainTime`                     | `z.iso.time()`                     | `format: time`         |
| `duration`                      | `z.iso.duration()`                 | `format: duration`     |
| `url`                           | `z.url()`                          | `format: uri`          |

**`{ offset: true }` was measured rather than chosen.** A bare `z.iso.datetime()` REJECTS
`2026-08-14T12:00:00+01:00`, which is valid RFC 3339 and valid `format: date-time`, so it would have
refused conformant callers. With the offset permitted every legal instant is accepted and only
genuine nonsense, `2026-02-31` and `banana`, is refused.

**`@format("...")` on a plain string is NOT enforced, and that is deliberate.** Under JSON Schema
2020-12, which OpenAPI 3.1 uses, `format` is an annotation rather than an assertion, so enforcing an
author's hint would add a rule the contract does not state. `@format("account-number")` is the case
proving no general rule exists. Where you need the guarantee, declare the type, or state it in a way
the document asserts: `@pattern`, `@minLength`, a named scalar with constraints.
