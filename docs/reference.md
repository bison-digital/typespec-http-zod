# Reference

Every option, every diagnostic, and the limits of what this emitter enforces.

## Options

Set under `options.typespec-http-zod` in `tspconfig.yaml`.

| option                 | what it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seal-object-schemas`  | Whether a model closed in the spec rejects an undeclared property rather than stripping it. Set this to whatever `@typespec/openapi3`'s option of the same name is set to: the two emitters answer the same question and neither can read the other's configuration. Defaults to `false`, which is openapi3's default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `compile-schemas`      | Whether every emitted validator is wrapped in `z.compile()`, Zod's ahead-of-time compiler - every one except a declaration on a reference cycle, which includes every discriminated base, since its dispatch names subtypes that extend it; naming a compiled schema from inside a cycle throws on the first parse at zod 4.6. Parsing the same values to the same results, faster: measured on an emitted five-property model at zod 4.6.5, `safeParse` goes from 130 ns to 64 ns, and on `workerd` 30,000 parses of an ordinary object schema go from 25-28 ms to 2-4 ms. Defaults to `false`, because it is a trade - compilation runs at module scope, and measured at scale on a generated 582-operation service (777 compiled schemas) in isolated node processes it costs about **45 ms of extra module evaluation**, against a Worker's 1 second startup budget. That cost cannot be measured on `workerd` itself: `performance.now()` does not advance during the startup phase, and from outside the delta sits below the noise floor of `wrangler dev`'s own startup. It also needs `new Function`, which a CSP or no-eval environment refuses (Zod degrades to the uncompiled schema there rather than throwing). On Cloudflare Workers this is the only route to a compiled schema, measured on `workerd` rather than read off a page: with this option a probe of the emitted schema reports a compiled fast path, and with Zod's own `import "zod/compile"` it reports none either side of the first parse - global mode compiles lazily, and that first parse happens inside a request, where `new Function` is refused. `new Function` IS permitted during a Worker's startup phase, which is when module scope runs. **`z.withParser()` is not the way round this, and was checked rather than assumed.** Zod 4.6 added it to install a parser built elsewhere, which sounds like exactly an emitter's job. But Zod ships no codegen that emits a parser as source - `compile` and `withParser` are the whole surface - so using it would mean this package writing its own Zod-to-JavaScript compiler, whose output would have to agree with Zod exactly or the server stops agreeing with its own document. `z.compile()` already works here because module scope is the startup phase, so there is nothing to buy. |
| `contracts-output-dir` | Where the framework-free contract types are written. Omitted, they are not emitted. Where two or more services write to it, each service's go in `<dir>/<ServiceName>`; a service that sets its own is not counted, so one service left writing here writes here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `contracts-package`    | The specifier the emitted Zod imports shared types from. No default. With none named, enums are emitted inline and the output depends on nothing. With more than one `@service` it is resolved from each service's own `wire-contract.gen.ts`, so a relative specifier names that service's contracts only where they are written beside its validators; where they are written elsewhere, or for a package specifier, set it per service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `key-vocabularies`     | Models whose property names are also emitted as a runtime tuple, for a closed key set that cannot be a `Record` key type. A name matching no model is reported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `regenerate-hint`      | The command that regenerates these files, written into every banner. `DO NOT EDIT` says what not to do and not what to do instead, and only the project knows whether that is `pnpm generate` or a `tsp compile` with three flags. Omitted, a generic line is kept. Settable per service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `services`             | Per-`@service` overrides, keyed by namespace name, for a spec publishing more than one surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

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

| code                               | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicate-declaration`            | Two different types claim one TypeScript name. The document tells them apart by namespace and a module cannot - or by a character an identifier cannot hold, written `_`, so `x-y` and `x_y` are both `x_y`. Or one model in two contexts: inside an explicit `@body`, where `@typespec/http` ignores its metadata annotations and the document holds them as data, and outside one, where they are metadata - two shapes under one name, which openapi3 refuses too, as `duplicate-type-name`; mark the body `@bodyRoot`, or give it a model of its own. Or one model at two visibilities openapi3 names alike - PATCH with and without implicit optionality, both `XUpdate` - which openapi3 refuses as `duplicate-type-name`. Reported once; the one declaration under the name validates nothing. A REPEAT of the same declaration is not this: visibility projection hands the registry a distinct type object for one model, and those are collapsed silently.                                                                                                                                                                               |
| `shared-input-key`                 | **A warning.** Two inputs of one operation that a handler would be handed under one key: `@header("x")` beside `@query("x")`, two `@query("x")`, a `@path id` beside a `@header("id")`, a parameter named as the body is. The input holds one value per key, so the key is typed and validated as both declarations at once - a value must satisfy each - except where both are in one location: the wire carries one value there, and the document publishes the first declaration, so the key is the first's and the second states nothing; and `EmittedRoute.sharedInputKeys` names the pair, so a server emitter declines to mount the operation. `@typespec/http` refuses only a path and a query parameter of one name. Give one of them a different name.                                                                                                                                                                                                                                                                                                                                                                                   |
| `unenforceable-encoded-constraint` | **A warning.** A constraint that `@encode` has moved onto a JSON type it does not apply to - a default is `invalid-default`. openapi3 applies a property's or a scalar's constraints and then lets the encoding replace `type`, so `@encode(string)` on a number publishes `minimum` beside `type: string`, and `@encode("x", int32)` on a string publishes `pattern` beside `type: integer`. JSON Schema ignores each there, so the document asserts nothing, and the validator drops it too: enforced, `@minValue(10)` would have refused `"42"` as too SHORT, and `.regex()` on an integer threw when the module loaded. A bound on a date under `unixTimestamp` is a number on the wire and is enforced, as the document publishes it. Declare the rule in a form the encoded value carries, such as a `@pattern` on a string, or remove `@encode`. Replaces `unenforceable-encoded-bound`, which reported numeric bounds on text and nothing else.                                                                                                                                                                                            |
| `invalid-default`                  | **A warning.** A default that is no value the position accepts: openapi3 publishes the JSON it serializes beside a schema the default need not satisfy - an encoding on the property or its scalar can change the type under it, a constraint can rule out the literal it names, a declaration above the property can refuse it - its `null` included - a keyword can rule it out, the property's, a declaration's above it or its scalar's, at any depth of a list or object, a key it sets can be one the position does not declare, or one the type requires can be missing. Filled in, it handed the handler a value its own type refuses, and the module did not compile. The property is validated as the document says, and only the fallback is dropped. Replace it with a value the property accepts, or remove it.                                                                                                                                                                                                                                                                                                                       |
| `non-unicode-pattern`              | **A warning.** A `@pattern` that is not a valid regular expression under the Unicode flag, which is how a JSON Schema reader compiles a published pattern: Ajv throws on it rather than evaluating it. The emitted validator falls back to running it without the flag, so the server enforces a rule no reader of its own document can. Remove the character the flag rejects, almost always a backslash that was never needed. See [Patterns and the cost of running them](#patterns-and-the-cost-of-running-them).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `unenforceable-property-name`      | **A warning.** A property whose wire name is `__proto__`. Zod skips that key on purpose so prototype pollution cannot reach through a parse ([colinhacks/zod#6386](https://github.com/colinhacks/zod/pull/6386)), so any value, or none, is accepted for it and dropped from the parsed result. The key is declared as a computed `["__proto__"]`, so the published schema states it and a sealed model does not refuse it; only its value goes unchecked. Give the property another wire name if its value has to be checked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `optional-prototype-name`          | **A warning.** An optional property whose wire name is an `Object.prototype` member - `constructor`, `toString`, `valueOf`, `hasOwnProperty` and the rest. Zod reads an absent one as the function every object inherits and refuses it ([colinhacks/zod#6666](https://github.com/colinhacks/zod/issues/6666)), so every value that leaves the property out is refused, on requests and responses alike. Reported wherever the property is optional, a merge-patch body included. Make it required, or give it another wire name, until Zod ships the fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `unsatisfiable-encoding`           | A property, parameter or scalar under `@encode` whose published schema no value satisfies, or which states no type. openapi3 keeps the declared type beside the encoded one, so `@encode("x", string)` on a model publishes `{ $ref: Filter, type: "string" }`, which nothing is; the same holds for a list model, an integer enum, or a string scalar encoded as `int32`. An encoding to a scalar outside the standard library publishes no `type` at all, and that is also how two scalars whose `@encode` name each other are caught. The property validates nothing until the spec says what it means. Encode it as a standard scalar its declared type admits, or remove `@encode`.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `never-body`                       | A request or response body declared `never`. The type has no values, and openapi3, whose body paths test only for `void`, publishes it as `application/json` with `schema: {}`, any value at all; a validator could agree with the spec or with the document, not both. Replace it with `void`, which declares no body and is published as none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `unpublishable-null`               | A `null` the spec admits and the OpenAPI 3.0 document openapi3 publishes does not, where it publishes 3.0 - its default. OAS 3.0.4's `nullable` "only takes effect if `type` is explicitly defined within the same Schema Object", and every other keyword still applies to `null`: openapi3 publishes `Inner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | null`as`{ type: object, allOf: [Inner], nullable: true }`, `Color | null`as`{ allOf: [Color], nullable: true }`, and `"a" | "b" | null`or`string | int32 | null`with an`enum`or an untyped`anyOf`beside`nullable`, and each refuses `null`; a bare `null`is`{ nullable: true }`, any value. `string | null`, a list, a record, a model expression, `unknown`and a union with a member of those beside a reference are published with`nullable`beside a`type`, and are validated as before. Set `openapi-versions: ["3.1.0"]`under`@typespec/openapi3`, whether or not it is emitted, to publish 3.1, which says `null`as`{ type: "null" }`. |
| `unpublishable-record`             | A sealed model whose base is a record, where openapi3 publishes OpenAPI 3.0. openapi3's 3.0 sealing is `additionalProperties: { not: {} }` beside the model's own `properties` - it re-declares a base's properties there - and a record declares none, so `model M extends Record<string> { name: string }` is published refusing every key the record admits; 3.1 seals with `unevaluatedProperties`, which sees the record through `allOf`. Set `openapi-versions: ["3.1.0"]` under `@typespec/openapi3`, or spread the record onto the model, `...Record<string>`, which is published open at every version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ambiguous-read-only`              | A request holding a required read-only property, where openapi3 publishes OpenAPI 3.0 and a later version. OAS 3.0.4 says such a `required` "will take effect on the response only", so the 3.0 document lets the request leave the property out; 3.1 made `readOnly` an annotation, so the later document requires it. One request validator cannot agree with both. Set one version, or declare the request's own view, `Create<Widget>`, which openapi3 publishes without the property.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `invalid-subtype-discriminator`    | A model a discriminated base's `mapping` names that no dispatch can hold: its discriminator is not one fixed value - `kind: "lab" \| string`, or `kind` renamed with `@encodedName` so it publishes its base's open `string` - or a declaration above it refuses its value, as `@maxLength(3) kind: string` refuses `"cobra"`. The first made Zod throw "Invalid discriminated union option" on import or on the first parse; the second is published as `allOf` that declaration, so no value is one. The base dispatches to its other subtypes. Declare the discriminator on the subtype as one fixed value every declaration above it admits - or, where the message says it is not visible at the request's visibility, make it visible there.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `sealed-base-extended`             | A template instance that adds a required property to a base openapi3 seals. Under `seal-object-schemas` openapi3 seals a model with no derived models it publishes, and a template instance is not one, so `Pet<string> extends Animal` leaves `Animal` sealed, and `Pet<string>` - published as `allOf` that sealed `Animal` - refuses every value carrying a property it adds. An optional property it adds is left out instead, so the sealed object refuses it whenever it is sent, as the document does. Declare it as a model of its own, `model PetString is Pet<string>`, which openapi3 counts as derived and so leaves `Animal` open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `unrepresentable-override`         | A property a subtype redeclares whose merge with a declaration above it refers back to itself: two unrelated recursive models, one redeclared over the other. openapi3 publishes the subtype as `allOf` its base, so the value must meet both, and this emitter merges the declarations of a key into one schema - a narrower one with the others' keywords, two models key by key, two lists element by element, a union member by member. A recursive merge is the one it does not declare, and it is refused rather than validated against one of the two. Declare the property on the subtype as the base's type, or a type derived from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `inline-cycle`                     | A reference cycle that never passes through anything this emitter can declare, so the cycle has no name to reference itself by. A template instantiation is the reachable case: it is inlined rather than declared, exactly as `@typespec/openapi3` inlines one, and that emitter refuses the same spec with its own `inline-cycle` error. Give the type a name with `@friendlyName`, which makes it a declaration and gives the back edge something to point at, or break the cycle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `split-visibility`                 | A schema `@typespec/openapi3` 1.17 publishes with its properties and its `required` read at two visibilities. openapi3 writes each component from the first reference that reaches it; where that is a request's, and the model has nothing the request reshapes, it reads `required` at `Read` and the properties at the request's visibility, so a read-only property is required and not declared - which no value satisfies under `seal-object-schemas` - or, optional, left out, and a sealed response refuses it. Every use of the component shares that schema, responses included. A model expression inside such a request is published the same way. Refused rather than validated against a schema the document does not hold. Send the request's own view as its body - `Create<Outer>`, `CreateOrUpdate<Outer>` - which openapi3 publishes apart, through every model it reaches, or move the read-only property out of the model.                                                                                                                                                                                                    |
| `header-case-collision`            | Two header parameters of one operation whose names differ only in case - `x-foo` and `X-Foo`. HTTP reads a header's name without its case (RFC 9110 section 5.1), so they are one header, which openapi3 publishes as two parameters of the one value it carries, held to both at once. Neither is validated: each is `never`, in the validator and the handler's input. Give one of them a different name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ambiguous-form-reading`           | A `@oneOf` body sent as a URL-encoded form where one member may read a key's text two ways - as the number or boolean it spells and as itself, or as one value and as a one-element list - and another member accepts one and not the other. The document accepts the form where some reading of its text matches exactly one member, and which reading that is depends on every key and member: finding it means trying every combination, exponential in the keys, and a record's keys are the sender's to choose. A `@oneOf` whose members read each key alike is validated, and so is one where every rival requires a key it refuses as the other member reads it, such as a `kind` literal. A discriminated union is no such `oneOf`. Give the key one reading, declare it alike in both members, or remove `@oneOf`.                                                                                                                                                                                                                                                                                                                        |
| `duplicate-operation-id`           | An explicit `@operationId` another operation already answers to. OpenAPI requires the id to be unique, and an explicit one is never renamed to make room, so it cannot be resolved for you. Ids DERIVED from a parent container are deduplicated silently, exactly as `@typespec/openapi3` deduplicates them, and raise nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `unsupported-type`                 | A construct with no runtime representation, or one this emitter does not validate. `never` in a union variant is the reachable case; a body declared `never` is `never-body`. A `never` property or parameter is dropped instead, matching the document. A parameter or response header typed as a tuple, which openapi3 publishes as `prefixItems` over values that are text on the wire, is refused here; a tuple anywhere else validates as the `prefixItems` the document publishes. An instance of a list template - `model Page<T> is T[]` made `Page<Item>` - which openapi3 publishes as an object of its elements, is refused here too. A union that reaches itself through union members alone - `union string { int32, string }` in a namespace, where the member names the union and not the scalar - is refused here too, and its service emits nothing: openapi3 publishes a schema that refers to itself with no value passed through, which JSON Schema leaves undefined; one passing through a list, a record, an object or an envelope is an ordinary recursive type. Reported once per declaration, though both walks reach it. |
| `unsupported-default`              | A default the document cannot publish either: one `serializeValueAsJson` cannot write as JSON, which openapi3 reports as `default-not-supported`. Literals, arrays and objects nested to any depth are emitted as written, and a scalar constructor such as `utcDateTime.fromISO(...)` as the JSON the document publishes for it - through the property's encoding, so under `unixTimestamp` it is a number. The property keeps its declared shape and loses only the fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `default-on-required-property`     | **A warning.** A default on a property the document publishes as `required`, where it can never apply, because a required property is never absent. `default` is an annotation under JSON Schema 2020-12 and `required` is the assertion; `@typespec/openapi3` builds `required` without ever consulting a default. So the validator requires the property and carries no fallback, exactly as the document describes it. Declare the property optional if callers may omit it. A key a discriminator makes required, or a declaration above it requires through `allOf`, is required however it is declared, and the message says which.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `truncated-doc-comment`            | **A warning.** A doc comment whose description the compiler cut short. An unescaped `@` begins a doc tag, so `{@link X}`, an email address, or `@maxLength` named in prose all end the description where they appear, with no diagnostic anywhere in the compiler. The loss reaches the OpenAPI document too, since `@typespec/openapi3` reads the same truncated string. Escape it as `\@`, backtick it, or write the description with `@doc(...)`. Only a comment is checked: an `@doc(...)` decorator wins, and `@` inside a string literal truncates nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `empty-union`                      | A union with no representable variants has nothing to validate against. `@typespec/openapi3` raises its own error for the same spec and writes no document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `unknown-key-vocabulary`           | A `key-vocabularies` entry naming no model in the service. This is a configuration error rather than a limit of the spec, reported because the failure mode is silence: a missing vocabulary looks exactly like an empty one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `unsupported-status-code-range`    | OpenAPI keys a range as `1XX` to `5XX`, so `@minValue(494) @maxValue(499)` has nowhere to go. `@typespec/openapi3` refuses the same spec and writes no document, so the same rule is copied from its source. A range covering a bucket exactly, `@minValue(400) @maxValue(499)`, is supported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `unmirrorable-seal`                | Two services resolve `seal-object-schemas` differently. `@typespec/openapi3` has no per-service options and applies one value to the whole program, so one of them would publish a document that disagrees with the validator emitted beside it - sealed here and silent there refuses a payload the document permits, and the reverse publishes a strictness the runtime does not enforce. Give every service the same value, or split the surfaces into separate compiles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `undeclared-discriminator`         | Upstream, and not fixable with an emitter option. `@discriminated(#{envelope: "none"})` puts the discriminator inside each variant on the wire, and openapi3 emits `oneOf` with a `discriminator` keyword while never adding that property to the variant schema, which OpenAPI 3.1 forbids. Tracked as [microsoft/typespec#7141](https://github.com/microsoft/typespec/issues/7141). Avoidable in your spec by declaring the discriminator on the variant, under its wire name, as `model Cat { kind: "cat" }`. A variant that declares it as no one fixed value - an open `string` it inherits - is refused too: no dispatch can tell its values from another variant's. A variant no value can be - its discriminator refused by a declaration above it, or a key it requires refused by a base openapi3 seals - is left out of the dispatch instead, as the document's `oneOf` accepts what its other members do.                                                                                                                                                                                                                              |

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
fourteen typical API patterns, four were flagged and only one of those could be made to backtrack; the three others include the official [semver.org](https://semver.org) regex,
which takes the full analysis budget to decide and then runs in 0.07 ms against every attack shape
tried. That is what `#suppress` is for.

The budget is `redos-detector`'s step count, 20,000 steps per distinct pattern, rather than a time
limit, so a pattern gets the same verdict on every machine. Spending it takes about 1.7 seconds idle
and longer under load, once per distinct pattern per compile, and only when the rule is enabled;
every ordinary pattern decides in milliseconds.

**The emitted regex is never changed.** `@typespec/openapi3` publishes the pattern verbatim; anchoring
or bounding it here would make the validator enforce something the document does not state, which is
the one trade this package refuses. The remedy belongs in the spec:

- **rewrite the pattern** so no input matches it two ways, usually by removing a quantifier nested
  inside another, or an optional separator between repeated groups;
- **or add a `@maxLength`**, which the document publishes too, so the two artefacts still agree. Bound
  the work rather than remove it, so only a small bound helps.

**It proves safety rather than guessing at danger**, so "not proven safe" is what the rule says.
Measured over a spread of 14 typical API patterns: two conservative warnings, both on
a quantifier nested over an overlapping class, and nothing dangerous missed. The analysis is itself
exponential in the bad case, so it is capped at that step count per distinct pattern and cached;
`^(a|a)+$` spends the whole budget.

## Declared names

A model, enum or named union is declared under the name the spec gives it, in every emitted file
alike. Two kinds of name are renamed with a trailing `_`, because the file could not declare them
otherwise:

- a name TypeScript refuses for a declaration in a module, read from the compiler's own keyword
  table: a reserved word, such as `as` or `yield`; a strict-mode one, such as `public` or
  `interface`; a predefined type, such as `string`, `never` or `unknown`; and a type operator,
  `keyof`, `infer`, `readonly` or `unique`;
- a name an emitted file declares for itself: `ByteStream`, `Produced`, `ResponseArm`,
  `SPEC_VOCABULARIES`, `Simplify`, `WireInputs`, `WireOutputs`, `WireReader`, `WireReaders` and
  `WireResults`, and the library types it names bare, `ArrayBuffer` and `Uint8Array`. A model named
  `WireInputs` would otherwise have merged into the lookup of that name rather than failed.

The rename is decided on the published name, visibility suffix included: a model named `WireReader`
is `WireReader_`, and its update view, which collides with nothing, `WireReaderUpdate`. Every other
library type the files name is written `globalThis.Record<...>`, `globalThis.Promise<...>`, so a
spec's own `Record` or `Promise` keeps its name.

No name `requests.gen.ts` declares is derived from an operation id; the per-operation validators in
`schemas.gen.ts` are, as `<operationId>Body` and the like. An operation's input is `WireInputs["createUser"]`,
which nothing a spec declares can collide with.

## The order things are written in

Every file is written in the order the spec declares what it holds, and so is what a wrapping
emitter reads: `EmittedService.routes`, `EmittedService.operations` and the
`EmittedService.service.operations` it is built from. That order is each declaration's source file,
as the program loaded its files, then its position in the file. Operations keep the grouping
`@typespec/http`'s `listOperationsIn` gives them, a namespace's own before its namespaces' and its
interfaces', each interface's operations as it declares them.

**This is not the order the compiler reaches them in**, which `@typespec/http` lists operations by.
The compiler files a namespace's interfaces, models and enums as it checks each, and a type is checked
early wherever something checked before it names it, so a second file whose only statement is an
augment decorator naming an operation, as a GraphQL surface's `@link` does, reorders that list.
Written in it, every route and validator moved. `@typespec/openapi3` sorts its output by key, so its
document never showed it.

What a schema says is still decided in openapi3's own order: which reference reaches a shared schema
first, and so the reading it is declared at, follows the operations as openapi3 meets them. Only
where a declaration lands is the spec's order.

## A declared type's validator, by the type

`EmittedService.typeSchemaNames` maps each declared type to the identifier `schemas.gen.ts` exports
its validator under, so an emitter built on this one imports a validator by name rather than
spelling the name itself.

- **The key is the type**: a model, union or enum the document publishes as a component of its own.
  A scalar is validated inline wherever it is used, and has no entry.
- **The keys are the types the service was emitted from, the ones `EmittedService.operations`
  holds.** A versioned service is emitted at its latest version, so its keys are the types projected
  to that version, not the types as declared.
- **A body is keyed by the model it is.** Where visibility reshapes a model, `@typespec/http` hands
  its body over as a copy, `{ ...Widget }`, which is not a key and has no `derivedModels`. Resolve it
  first, as openapi3 does:
  `createMetadataInfo(program, { canonicalVisibility: Visibility.Read }).getEffectivePayloadType(body.type, Visibility.Read)`.
- **The value is the declaration under the type's own component name**: the one a response reads,
  wherever a response reads the type. A view of it, `widgetCreateSchema`, and a 3.0 request's reading
  of it are not in the map. The name is the module's, renamed as [Declared names](#declared-names)
  says: `@friendlyName("Canine") model Hound` is `canineSchema`, `` model `default` `` is
  `default_Schema`. A multipart body's model is in it, validated as the form the document publishes.
  A type the document publishes only as views, sent in create and update bodies and never returned,
  has no entry.
- **Every subtype of a discriminated base has an entry**, nested bases included and whether or not an
  operation names it. A base's parsed output does not say which arm of its dispatch matched, so the
  subtype's own validator is how a value is told apart: a `{ kind: "puppy", age: 5 }` that differs
  from a `Puppy` only by `@maxValue(1)` is a `Pet`.
- **A declaration refused whole has no entry**, `duplicate-declaration` and `split-visibility`
  among them, so a lookup answers `undefined` rather than a `z.never()`. A model holding a refused type
  is a declaration of its own and keeps its entry. Its validator refuses any value carrying that
  property.

`test/typeschemanames` grades each of these against the module, and
`conformance/typenames.test.ts` checks every entry, and every component the module validates, across
the corpus against the component openapi3 publishes for the type.

## Descriptions

Every description `@typespec/openapi3` publishes in a schema, the emitted validators carry, through
`.describe()`. Zod keeps it in `z.globalRegistry`, which `z.toJSONSchema` and Zod's Standard Schema
converter read by default, so a surface publishing JSON Schema from these validators - an MCP
server's `tools/list` among them - publishes the descriptions too. A description changes nothing a
parse decides.

| Position                              | Description                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A model, enum or named union          | Its doc, on the declaration itself, so every reference names one described schema. A visibility projection carries the doc of the model it projects.                                  |
| A property or parameter               | Its doc, outermost - outside `.nullable()`, `.exactOptional()` and `.default()`. An operation's `@param` tag is the parameter's doc.                                                  |
| A property typed by a declared scalar | The property's doc if it has one, else the scalar's, else the nearest one up the scalar's `extends` chain - the order a reader resolves openapi3's sibling `description` over `$ref`. |
| `T \| null` of a declared scalar      | The scalar's doc inside `.nullable()`, as openapi3 publishes it on the `anyOf` branch, and the property's outside it.                                                                 |
| A standard scalar                     | None. openapi3 deletes the compiler's own doc on `string`, `int32` and the rest, and so does this.                                                                                    |

`test/descriptions` compares each position against the document compiled from the same spec, and
`conformance/differential.test.ts` does the same for every component of the corpus.

## Known limits

- **`format` is not enforced.** Under JSON Schema 2020-12 `format` is an annotation rather than a
  validation keyword, so turning one into a check would enforce something the document does not
  assert. 145 annotations go unenforced across the conformance corpus.
- **4 negotiated response bodies cannot be attributed to a single arm.** OpenAPI lists one body per
  media type against members that each carry their own, so there is no single arm to compare them to.
  The status-to-body mapping is still checked.
- **A reserved path parameter is carried in the route record and not in the document, which is the
  one place this IR deliberately says more than OpenAPI can.** `@route("/files/{+path}")` states RFC
  6570 reserved expansion: the parameter matches across `/`, so `GET /files/docs/guide.md` reaches
  one operation. OpenAPI has no way to express that at **any** version - measured at 3.0.0, 3.1.0 and
  3.2.0 - so `@typespec/openapi3` publishes `/files/{path}` and raises `path-reserved-expansion` as a
  warning, which a spec suppresses per operation. `EmittedRoute.reservedPathParameters` carries
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
- **A `/` path expansion is published without its operator, and decoded as the route declares it.**
  `@route("/files{/path*}")` states RFC 6570 path-segment expansion: `["a", "b"]` is `/files/a/b`
  and `{ a: 1, b: 2 }` is `/files/a=1/b=2`, which is what `@typespec/http-specs` expects of
  `{/v*}`. OpenAPI has no such style for a path parameter, so `@typespec/openapi3` publishes
  `/files{path}` - the operator and its `/` dropped - with `style: simple`, and raises
  `invalid-style` as a warning. Under `simple` an exploded list is `a,b` with no `/` before it, so
  the document describes `/filesa,b`, a URL the route does not match, and no request a server
  mounted from the route receives is one the document reads as a list. `EmittedRoute.pathSegments`
  carries the operator, and the path validator undoes the expansion the route declares: `a/b`,
  joined by `/`, where the document's style joins `a,b`. An unexploded `{/v}` joins a list with `,`
  under both. As for `{+v}`, this emitter raises no warning of its own: the divergence is the
  document's limit, and openapi3 reports it.
- **An optional property named after an `Object.prototype` member refuses its own omission.** A
  Zod defect, [colinhacks/zod#6666](https://github.com/colinhacks/zod/issues/6666): an absent
  `constructor?` reads as the inherited function. The emitted validators inherit it, and
  `optional-prototype-name` reports each property it bites. A required one is unaffected.
  `test/inheritednames` pins the defect, so the Zod release that fixes it is noticed and the peer
  floor moves to it.
- **A property named `__proto__` is published and never validated.** Zod skips the key by design.
  `unenforceable-property-name` reports it.
- **A record or open object accepts a `__proto__` key and drops it, whatever its value.** Zod
  strips `__proto__` before any key or value schema runs, so prototype pollution cannot reach through
  a parse ([colinhacks/zod#6386](https://github.com/colinhacks/zod/issues/6386), deliberate).
  Measured on 4.5.0 and 4.6.5: `{"__proto__": 1}` passes `Record<boolean>`, and an open model's
  indexer, and parses to `{}`; the document refuses it, because JSON Schema reads `__proto__` like any
  other key. A sealed object refuses it as an unrecognised key, as the document does. The key never
  reaches a handler, so what is lost is agreement, not safety. **Close it at the JSON parser, where the
  ecosystem does:** Fastify (`onProtoPoisoning`) and hapi (`payload.protoAction`) refuse such a body
  by default through `secure-json-parse`, and `typespec-hono` does the same, for a JSON body and for a
  multipart JSON part, whose JSON the part's validator parses. A form or query value carrying the key
  is dropped, as the `qs` parser drops it by default (`allowPrototypes: false`).
- **A shared route's parameter declared as two types is validated as each operation declares it.**
  openapi3 publishes one operation per `@sharedRoute` path and verb, and one parameter per name and
  location - the first operation's schema, with the `enum`s of literal ones joined - so `ta(@header
h: string)` beside `tb(@header h: int32)` publishes `h` as a `string`. Each operation's validator
  still reads its own declaration, as a router dispatching between them needs: `kind: "a"` and
  `kind: "b"` on one path are told apart by exactly that. Where a parameter is missing from one
  operation, or declared unalike, it is optional, as openapi3 publishes it.
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

## Where the contract types differ from openapi-typescript

`openapi-typescript` 7.13.0, run on the document `@typespec/openapi3` publishes from the same spec, is
the reference for what `requests.gen.ts` states. Measured over the conformance corpus and the test
fixtures: every operation and every declared status is present in both. Where the two differ, it is
for one of these reasons, and nothing else.

| `requests.gen.ts` says                                                                                                       | openapi-typescript says     | why                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| an open or `additionalProperties` model has no index signature                                                               | `[key: string]: unknown`    | the type is a floor, the properties a producer must supply; an index signature is an obligation on the producer, and the validator still passes unknown keys through              |
| a discriminated base is the union of its subtypes and the base itself                                                        | the base model              | a value is valid exactly as the base is; one that is a valid instance of the subtype its discriminator names is that subtype, and the union is what narrows to it                 |
| a property with a default is optional, `?: T \| undefined`                                                                   | required                    | the contract is the caller's view: a caller may leave it out, and `.default()` accepts `undefined` and fills it. A handler receives it filled                                     |
| a response body is `Produced<T>`, deeply `readonly`                                                                          | `T`                         | a producer may hand back a readonly view, and nothing the server does depends on mutability                                                                                       |
| a binary or streamed body is `ByteStream` (a request) or `ByteStream \| Uint8Array<ArrayBuffer> \| ArrayBuffer` (a response) | `string`                    | the bytes are handed over unread, and a platform stream satisfies `ByteStream` with no DOM or runtime library                                                                     |
| a body under a media type nothing parses, such as a model as `application/xml`, is `string`                                  | the model                   | it is the text that arrives or is sent; the model is still declared. Under a type that is not text, such as `application/octet-stream`, it is bytes, as a binary body is          |
| a multipart file part is a structural `{ name, type, arrayBuffer() }`                                                        | `string`                    | the part a server hands over is a file, and `File` needs an ambient library                                                                                                       |
| a `@sharedRoute`'s operations are keyed separately                                                                           | one operation per path item | each is its own operation in the spec, chosen by its `accept`                                                                                                                     |
| an optional path parameter is optional                                                                                       | required                    | TypeSpec declares it optional, and the route admits its absence; OpenAPI requires every path parameter                                                                            |
| a `GET` or `HEAD` body with no member visible at `Query` is not part of the input                                            | the body the document lists | the body is typed at the method's request visibility; in `type/model/visibility` its one `Query` member is a query parameter, and the scenario states the request carries no body |

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

The contract types in `requests.gen.ts` state the validator's input, `z.input`, so an optional
property is `?: T` there too. The one exception is a property with a default: `.default(v)` accepts an
explicit `undefined` and fills `v`, so its contract type is `?: T | undefined`. `wire-contract.gen.ts`
compares the two with nothing widened.

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
what decides whether a body under a non-JSON media type is the text itself. `EmittedService.schemaNames`
gives the identifier each arm's body is declared under, in the same order.

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
author's hint would add a rule the contract does not state. `@format("product-code")` is the case
proving no general rule exists. Where you need the guarantee, declare the type, or state it in a way
the document asserts: `@pattern`, `@minLength`, a named scalar with constraints.
