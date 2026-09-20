# Reference

Every option, every diagnostic, and the limits of what this emitter enforces.

## Options

Set under `options.typespec-http-zod` in `tspconfig.yaml`.

| option                 | what it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seal-object-schemas`  | Whether a model closed in the spec rejects an undeclared property rather than stripping it. Set this to whatever `@typespec/openapi3`'s option of the same name is set to: the two emitters answer the same question and neither can read the other's configuration. Defaults to `false`, which is openapi3's default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `compile-schemas`      | Whether every emitted validator is wrapped in `z.compile()`, Zod's ahead-of-time compiler. Parsing the same values to the same results, faster: measured on an emitted five-property model at zod 4.6.5, `safeParse` goes from 130 ns to 64 ns, and on `workerd` 30,000 parses of an ordinary object schema go from 25-28 ms to 2-4 ms. Defaults to `false`, because it is a trade - compilation runs at module scope, and measured at scale on a generated 582-operation service (777 compiled schemas) in isolated node processes it costs about **45 ms of extra module evaluation**, against a Worker's 1 second startup budget. That cost cannot be measured on `workerd` itself: `performance.now()` does not advance during the startup phase, and from outside the delta sits below the noise floor of `wrangler dev`'s own startup. It also needs `new Function`, which a CSP or no-eval environment refuses (Zod degrades to the uncompiled schema there rather than throwing). On Cloudflare Workers this is the only route to a compiled schema, measured on `workerd` rather than read off a page: with this option a probe of the emitted schema reports a compiled fast path, and with Zod's own `import "zod/compile"` it reports none either side of the first parse - global mode compiles lazily, and that first parse happens inside a request, where `new Function` is refused. `new Function` IS permitted during a Worker's startup phase, which is when module scope runs. **`z.withParser()` is not the way round this, and was checked rather than assumed.** Zod 4.6 added it to install a parser built elsewhere, which sounds like exactly an emitter's job. But Zod ships no codegen that emits a parser as source - `compile` and `withParser` are the whole surface - so using it would mean this package writing its own Zod-to-JavaScript compiler, whose output would have to agree with Zod exactly or the server stops agreeing with its own document. `z.compile()` already works here because module scope is the startup phase, so there is nothing to buy. |
| `contracts-output-dir` | Where the framework-free contract types are written. Omitted, they are not emitted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `contracts-package`    | The specifier the emitted Zod imports shared types from. No default. With none named, enums are emitted inline and the output depends on nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `key-vocabularies`     | Models whose property names are also emitted as a runtime tuple, for a closed key set that cannot be a `Record` key type. A name matching no model is reported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `regenerate-hint`      | The command that regenerates these files, written into every banner. `DO NOT EDIT` says what not to do and not what to do instead, and only the project knows whether that is `pnpm generate` or a `tsp compile` with three flags. Omitted, a generic line is kept. Settable per service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `services`             | Per-`@service` overrides, keyed by namespace name, for a spec publishing more than one surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## What it refuses, and why

Every refusal is a diagnostic. It points at the offending declaration, carries a code you can search
for, and does not stop the walk, so one compile names every problem rather than the first.

Some are **warnings** rather than errors, marked in the table. Two of them share a reason worth
stating. `default-on-required-property` and `truncated-doc-comment` both name a spec `@typespec/openapi3`
emits happily, so refusing either would make the same spec representable by one emitter and not the
other - the one thing a differential between the two cannot tolerate. An error would also set
`program.hasError()`, which costs the whole document over one property or one comment. What is wrong
with these two is not that they cannot be served, but that the author has written something that
does not mean what they almost certainly intended.

| code                            | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicate-declaration`         | Two different types claim one TypeScript name. The document tells them apart by namespace and a module cannot. A REPEAT of the same declaration is not this: visibility projection hands the registry a distinct type object for one model, and those are collapsed silently.                                                                                                                                                                                                                                                                                     |
| `unenforceable-encoded-bound`   | **A warning.** A `@minValue`/`@maxValue` (or the exclusive form) on a property `@encode(string)` carries as text. The bound is on the number; the emitted expression is a string, so enforcing it would check how many characters the value has - `@minValue(10)` would refuse `"42"`. The document is no help either: it publishes `minimum` on a `type: string` schema, which JSON Schema ignores. The bound is dropped rather than mistranslated. Declare it as a `@pattern`, or remove `@encode(string)`.                                                     |
| `non-unicode-pattern`           | **A warning.** A `@pattern` that is not a valid regular expression under the Unicode flag, which is how a JSON Schema reader compiles a published pattern: Ajv throws on it rather than evaluating it. The emitted validator falls back to running it without the flag, so the server enforces a rule no reader of its own document can. Remove the character the flag rejects, almost always a backslash that was never needed. See [Patterns and the cost of running them](#patterns-and-the-cost-of-running-them).                                             |
| `inline-cycle`                  | A reference cycle that never passes through anything this emitter can declare, so the cycle has no name to reference itself by. A template instantiation is the reachable case: it is inlined rather than declared, exactly as `@typespec/openapi3` inlines one, and that emitter refuses the same spec with its own `inline-cycle` error. Give the type a name with `@friendlyName`, which makes it a declaration and gives the back edge something to point at, or break the cycle.                                                                             |
| `duplicate-operation-id`        | An explicit `@operationId` another operation already answers to. OpenAPI requires the id to be unique, and an explicit one is never renamed to make room, so it cannot be resolved for you. Ids DERIVED from a parent container are deduplicated silently, exactly as `@typespec/openapi3` deduplicates them, and raise nothing.                                                                                                                                                                                                                                  |
| `unsupported-type`              | A construct with no runtime representation. `never` in a body or a union variant is the reachable case. A `never` property is dropped instead, matching the document.                                                                                                                                                                                                                                                                                                                                                                                             |
| `unsupported-default`           | A default with no literal form, such as the scalar constructor `utcDateTime.fromISO(...)`. Scalars, arrays and objects nested to any depth are emitted as literals. The property keeps its declared shape and loses only the fallback.                                                                                                                                                                                                                                                                                                                            |
| `default-on-required-property`  | **A warning.** A default on a property the document publishes as `required`, where it can never apply, because a required property is never absent. `default` is an annotation under JSON Schema 2020-12 and `required` is the assertion; `@typespec/openapi3` builds `required` without ever consulting a default. So the validator requires the property and carries no fallback, exactly as the document describes it. Declare the property optional if callers may omit it.                                                                                   |
| `truncated-doc-comment`         | **A warning.** A doc comment whose description the compiler cut short. An unescaped `@` begins a doc tag, so `{@link X}`, an email address, or `@maxLength` named in prose all end the description where they appear, with no diagnostic anywhere in the compiler. The loss reaches the OpenAPI document too, since `@typespec/openapi3` reads the same truncated string. Escape it as `\@`, backtick it, or write the description with `@doc(...)`. Only a comment is checked: an `@doc(...)` decorator wins, and `@` inside a string literal truncates nothing. |
| `empty-union`                   | A union with no representable variants has nothing to validate against. `@typespec/openapi3` raises its own error for the same spec and writes no document.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `unknown-key-vocabulary`        | A `key-vocabularies` entry naming no model in the service. This is a configuration error rather than a limit of the spec, reported because the failure mode is silence: a missing vocabulary looks exactly like an empty one.                                                                                                                                                                                                                                                                                                                                     |
| `unsupported-status-code-range` | OpenAPI keys a range as `1XX` to `5XX`, so `@minValue(494) @maxValue(499)` has nowhere to go. `@typespec/openapi3` refuses the same spec and writes no document, so the same rule is copied from its source. A range covering a bucket exactly, `@minValue(400) @maxValue(499)`, is supported.                                                                                                                                                                                                                                                                    |
| `unmirrorable-seal`             | Two services resolve `seal-object-schemas` differently. `@typespec/openapi3` has no per-service options and applies one value to the whole program, so one of them would publish a document that disagrees with the validator emitted beside it - sealed here and silent there refuses a payload the document permits, and the reverse publishes a strictness the runtime does not enforce. Give every service the same value, or split the surfaces into separate compiles.                                                                                      |
| `undeclared-discriminator`      | Upstream, and not fixable with an emitter option. `@discriminated(#{envelope: "none"})` puts the discriminator inside each variant on the wire, and openapi3 emits `oneOf` with a `discriminator` keyword while never adding that property to the variant schema, which OpenAPI 3.1 forbids. Tracked as [microsoft/typespec#7141](https://github.com/microsoft/typespec/issues/7141). Avoidable in your spec by declaring the discriminator on the variant, as `model Cat { kind: "cat" }`.                                                                       |

## Linter rules

Opt-in checks for a spec that is valid but could be better. None runs until a project enables it.

| Rule                  | What it flags                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redos-prone-pattern` | A `@pattern` that cannot be proven safe against catastrophic backtracking. See [Patterns and the cost of running them](#patterns-and-the-cost-of-running-them). Enabled by `typespec-http-zod/recommended`. |

## Cookie parameters

`@cookie` is emitted as its own validator group, `<OperationId>Cookie`, beside `Path`, `Query` and
`Header`. Its values arrive as text and are decoded and constrained exactly as a header's are, and
its optionality is the document's `required`.

It is a separate group rather than part of the header one because the document states the two
separately and a server mounts one validator per location - merged, a cookie would be read from a
header of the same name. `CookieOptions` carries only a name, so there is no collection encoding to
undo.

**This did nothing at all before 0.27.** A `@cookie` reached no validator, no contract type and no
diagnostic, while `@typespec/openapi3` published it as `in: cookie, required: true`. It survived
every conformance oracle because `@typespec/http-specs` contains no `@cookie`: the differential
compared every location the corpus exercises and agreed with the document about all of them.

## Patterns and the cost of running them

A `@pattern` is not a description. It is a regular expression the server runs on caller-supplied
input, on every request, before any handler sees it - and a backtracking engine can be made to spend
exponential time on the wrong one.

Measured on a generated server under `workerd`, with `@pattern("^(\w+\s?)*$")` on a query
parameter, which is what an author writes to mean "words":

| input         | answer | time    |
| ------------- | ------ | ------- |
| `hello world` | 200    | 0.003 s |
| 21 bytes      | 400    | 0.010 s |
| 25 bytes      | 400    | 0.127 s |
| 29 bytes      | 400    | 2.743 s |
| 31 bytes      | 400    | 7.799 s |

Roughly twice the work per added byte, from a caller with no credential and a 31-byte payload. The
shape is not always obvious: `^\w+([.-]?\w+)*$` reads as an ordinary identifier rule and takes 11
seconds on a 29-character input, while `^[a-z]+(-[a-z]+)*$` has the same nesting and is perfectly
safe, because its separator is required and so the split is forced.

So the package ships a **linter rule**, `redos-prone-pattern`, that checks each pattern with
[`redos-detector`](https://github.com/tjenkinson/redos-detector) and flags one it cannot prove safe.
It is **off until you enable it**, and you should:

```yaml
# tspconfig.yaml
linter:
  extends:
    - "typespec-http-zod/recommended"
```

A project on `typespec-hono` enables it through that package instead, as
`"typespec-hono/recommended"`, because it never loads this package as a TypeSpec library and so
cannot name it.

**Why a linter rule and not a diagnostic.** TypeSpec draws the line in its own documentation: a
diagnostic says the program is not valid for the library, while a linter is for a program that "could
be correct, but there might be room for improvements", and "linters need to be explicitly enabled".
A dangerous pattern is the second kind. The spec is valid, the document is correct and the emitted
regex is exactly the published one, so what is wrong is a cost no artefact states. `@typespec/http`
puts its own advisory rule in a linter for the same reason.

The difference is not academic. An advisory raised as an automatic warning fails the build of every
project that sets `warn-as-error: true`, whether or not the project asked for the advice.

A pattern you have looked at and decided to keep is acknowledged where it is declared, with a reason:

```tsp
#suppress "typespec-http-zod/redos-prone-pattern" "Bounded by @maxLength(64); measured at 0.1 ms"
@pattern("^\\w+([.-]?\\w+)*$")
scalar Handle extends string;
```

The check is **conservative**: it proves that one input can match a pattern more than one way, which
is necessary for catastrophic backtracking but not sufficient for it to be reachable. Measured over
fourteen patterns an API author actually writes, four were flagged and only one of those could be
made to backtrack; the three others include the official [semver.org](https://semver.org) regex,
which takes the full analysis timeout to decide and then runs in 0.07 ms against every attack shape
tried. That is what `#suppress` is for.

Deciding an unprovable pattern costs the analyser up to 500 ms, once per distinct pattern per
compile, and only when the rule is enabled. Twenty of them is ten seconds on a cold build.

**The emitted regex is never changed.** `@typespec/openapi3` publishes the pattern verbatim; anchoring
or bounding it here would make the validator enforce something the document does not state, which is
the one trade this package refuses. The remedy belongs in the spec:

- **rewrite the pattern** so no input matches it two ways, usually by removing a quantifier nested
  inside another, or an optional separator between repeated groups;
- **or add a `@maxLength`**, which the document publishes too, so the two artefacts still agree. Bound
  the work rather than remove it, so only a small bound helps.

**It proves safety rather than guessing at danger**, so "not proven safe" is what the rule says.
Measured over a realistic spread of 14 patterns an API would carry: two conservative warnings, both on
a quantifier nested over an overlapping class, and nothing dangerous missed. The analysis is itself
exponential in the bad case, so it is capped at 500 ms per distinct pattern and cached, `^(a|a)+$`
alone takes 1.6 seconds to decide.

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
- **A route's RFC 6570 form is carried in the route record, and its values are decoded.**
  `@typespec/http` strips every operator from `path`, so `array{.param*}` and `array{;param}` both
  reach it as `array{param}`. `EmittedRoute.pathSegments` carries each segment as literal text or one
  expression (its parameter, the literal around it, operator and explode), and `literalQuery` the pairs
  of a query string written into the route (`?fixed=true{&param}`). A server mounts from those and hands
  the path validator the segment's text; the validator undoes the expansion (`array.a.b` is
  `["a", "b"]`, `record;a=1;b=2` is `{ a: 1, b: 2 }`) and refuses text that is not the declared one. A
  form-exploded query record or model (`?a=1&b=2`) is gathered back under its parameter name. The
  decoders are declared in `schemas.gen.ts` only where a validator calls them. A segment holding two
  expressions is `unsupported`.

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

`<operationId>Responses` lists every response the document declares for an operation, one arm per
status key, in OpenAPI's precedence order: exact codes ascending, then ranges such as `4XX`, then
`default`. Every arm carries the same facts, whatever kind of status it is and whether it is a
success or a failure:

| field          | what it is                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `status`       | the status key as the document writes it: a number, `"4XX"`, or `"default"`                                   |
| `schema`       | the validator for that status's own body, or `undefined` where the response declares no body                  |
| `contentTypes` | every media type the document names for that status, including a single one. Absent where there is no body    |
| `headers`      | each declared header by the WIRE name the response sets, with `optional` for the document's `required: false` |

`contentTypes` and `headers` are absent where the document names none, so "none declared" and "none
carried" are the same state rather than two an application has to tell apart.

`armFor(arms, status)` returns the arm that governs a status: the exact code first, then its range,
then `default`.

**Each status has its own arm, and the handler names the status.** Two success statuses with
different bodies get two arms with two schemas. There is no selector naming a property to read the
choice from, because the property name is a TypeSpec detail the document does not publish.

**Every operation is emitted.** An operation whose only success is a `2XX` range, or whose only
response is a redirect, gets its arms like any other.

`EmittedRoute.responses` publishes the same facts to an emitter built on this API, with each header's
TypeScript type, whether a body is raw binary (`binary`, whose schema is `z.unknown()`), whether it
is a stream of events or lines (`streamed`), and whether its type is a string (`textual`), which is
what decides whether a body under a non-JSON media type is the text itself. `EmittedService.schemaNames` gives the identifier each
arm's body is declared under, in the same order.

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
