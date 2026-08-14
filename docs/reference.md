# Reference

Every option, every diagnostic, and the limits of what this emitter enforces.

## Options

Set under `options.typespec-http-zod` in `tspconfig.yaml`.

| option                 | what it does                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seal-object-schemas`  | Whether a model closed in the spec rejects an undeclared property rather than stripping it. Set this to whatever `@typespec/openapi3`'s option of the same name is set to: the two emitters answer the same question and neither can read the other's configuration. Defaults to `false`, which is openapi3's default. |
| `contracts-output-dir` | Where the framework-free contract types are written. Omitted, they are not emitted.                                                                                                                                                                                                                                    |
| `contracts-package`    | The specifier the emitted Zod imports shared types from. No default. With none named, enums are emitted inline and the output depends on nothing.                                                                                                                                                                      |
| `key-vocabularies`     | Models whose property names are also emitted as a runtime tuple, for a closed key set that cannot be a `Record` key type. A name matching no model is reported.                                                                                                                                                        |
| `runtime-module`       | Where the generated files import `ResponseArm` from. Defaults to `typespec-http-zod/runtime`.                                                                                                                                                                                                                          |
| `services`             | Per-`@service` overrides, keyed by namespace name, for a spec publishing more than one surface.                                                                                                                                                                                                                        |

## What it refuses, and why

Every refusal is a diagnostic. It points at the offending declaration, carries a code you can search
for, and does not stop the walk, so one compile names every problem rather than the first.

| code                            | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicate-declaration`         | Two different types claim one TypeScript name. The document tells them apart by namespace and a module cannot. A REPEAT of the same declaration is not this: visibility projection hands the registry a distinct type object for one model, and those are collapsed silently.                                                                                                                                                                                                               |
| `duplicate-operation-id`        | An explicit `@operationId` another operation already answers to. OpenAPI requires the id to be unique, and an explicit one is never renamed to make room, so it cannot be resolved for you. Ids DERIVED from a parent container are deduplicated silently, exactly as `@typespec/openapi3` deduplicates them, and raise nothing.                                                                                                                                                            |
| `unsupported-type`              | A construct with no runtime representation. `never` in a body or a union variant is the reachable case. A `never` property is dropped instead, matching the document.                                                                                                                                                                                                                                                                                                                       |
| `unsupported-default`           | A default with no literal form, such as the scalar constructor `utcDateTime.fromISO(...)`. Scalars, arrays and objects nested to any depth are emitted as literals. The property keeps its declared shape and loses only the fallback.                                                                                                                                                                                                                                                      |
| `empty-union`                   | A union with no representable variants has nothing to validate against. `@typespec/openapi3` raises its own error for the same spec and writes no document.                                                                                                                                                                                                                                                                                                                                 |
| `unknown-key-vocabulary`        | A `key-vocabularies` entry naming no model in the service. This is a configuration error rather than a limit of the spec, reported because the failure mode is silence: a missing vocabulary looks exactly like an empty one.                                                                                                                                                                                                                                                               |
| `unsupported-status-code-range` | OpenAPI keys a range as `1XX` to `5XX`, so `@minValue(494) @maxValue(499)` has nowhere to go. `@typespec/openapi3` refuses the same spec and writes no document, so the same rule is copied from its source. A range covering a bucket exactly, `@minValue(400) @maxValue(499)`, is supported.                                                                                                                                                                                              |
| `undeclared-discriminator`      | Upstream, and not fixable with an emitter option. `@discriminated(#{envelope: "none"})` puts the discriminator inside each variant on the wire, and openapi3 emits `oneOf` with a `discriminator` keyword while never adding that property to the variant schema, which OpenAPI 3.1 forbids. Tracked as [microsoft/typespec#7141](https://github.com/microsoft/typespec/issues/7141). Avoidable in your spec by declaring the discriminator on the variant, as `model Cat { kind: "cat" }`. |

## Known limits

- **`format` is not enforced.** Under JSON Schema 2020-12 `format` is an annotation rather than a
  validation keyword, so turning one into a check would enforce something the document does not
  assert. 142 annotations go unenforced across the conformance corpus.
- **4 negotiated response bodies cannot be attributed to a single arm.** OpenAPI lists one body per
  media type against members that each carry their own, so there is no single arm to compare them to.
  The status-to-body mapping is still checked.
- **4 response bodies reduce to no readable kind on one side**, being a stream or a union.
- **A `@head` operation gets validators here and cannot be served by every router.** That is a
  property of the server rather than of this package.
- **The emitted output requires `zod`, not `zod/mini`.** The tree-shakeable variant has no chained
  methods, and the emitted validators use `.optional()`, `.nullable()`, `.default()`, `.strict()`,
  `.loose()` and `.catchall()`.
- **`int64` and `uint64` above `2^53-1` are refused.** Above that bound an integer is no longer
  uniquely representable as a JavaScript number, so a validator cannot certify that the value it
  holds is the value that was sent. `9007199254740993` reaches a handler as `9007199254740992`
  through `JSON.parse`, before any validator runs. Use `@encode(string)` for 64-bit integers whose
  values can exceed that bound: it emits `z.string()`, and openapi3 publishes `type: string`.

## Zod version support

The `zod` peer range is `^4.0.0`. Every construct the emitter writes was verified at 4.0.0 and at
4.4.3, including `z.strictObject`, `z.looseObject`, `z.discriminatedUnion`, `z.preprocess`,
two-argument `z.record`, `.catchall()` and `z.lazy()`.

## Compatibility

Node 22 or later. The emitter runs on the stable TypeSpec 1.x surface: `$onEmit` plus
`@typespec/http`.
