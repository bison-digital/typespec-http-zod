# typespec-http-zod

Zod validators generated from the same API definition as your OpenAPI document.

## What is it?

An emitter for [TypeSpec](https://typespec.io), Microsoft's language for describing APIs. Describe
your API once, and this package generates the Zod schemas that validate every request and response,
plus the TypeScript types to go with them.

TypeSpec compiles to OpenAPI as well, so the same definition also gives you documentation that cannot
drift from the validation.

One model:

```tsp
model Widget {
  id: string;

  @minLength(1)
  name: string;
}
```

The validators and types this package generates:

```ts
export const widgetSchema = z.object({
	id: z.string(),
	name: z.string().min(1),
});

export type Widget = z.infer<typeof widgetSchema>;
```

And the OpenAPI that [`@typespec/openapi3`](https://typespec.io) generates from that same model:

```jsonc
"Widget": {
  "type": "object",
  "required": ["id", "name"],
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string", "minLength": 1 }
  }
}
```

## Features

- **Documentation and validation cannot drift** - both come from one definition, so there is no
  second source to keep in step
- **Agrees with the OpenAPI version you publish** - 3.0, `@typespec/openapi3`'s default, and 3.1 read
  some schemas differently; the validators follow the `openapi-versions` you give openapi3, and refuse
  at compile what a 3.0 document cannot say. See [OpenAPI versions](docs/guides.md#openapi-versions)
- **One runtime dependency** - `zod`, and nothing else
- **No framework** - use the validators in a server, a client, or a test
- **Types with zero imports** - a contracts module anything can depend on
- **Built on a public API** - [`typespec-hono`](https://github.com/bison-digital/typespec-hono)
  generates a whole Hono server from it

## Install

```bash
npm install typespec-http-zod
```

Install it as a regular dependency if your application calls `armFor`. If you use only the emitted
validators, a dev dependency is enough. See [installing](docs/guides.md#installing).

Peer dependencies: `@typespec/compiler`, `@typespec/http`, `@typespec/openapi`, and `zod`.
`@typespec/versioning` and `@typespec/streams` are optional.

## Quick start

```
main.tsp                  your API definition
tspconfig.yaml            which emitters to run
src/
  generated/              written by `tsp compile`, never edited by hand
    schemas.gen.ts
  index.ts                your code
```

### `main.tsp`

```tsp
import "@typespec/http";

using Http;

@service(#{ title: "Widget API" })
namespace WidgetApi;

model Widget {
  id: string;

  @minLength(1)
  name: string;

  @minValue(0)
  quantity: int32;
}

@error
model NotFound {
  @statusCode statusCode: 404;
  code: string;
  message: string;
}

@route("/widgets/{widgetId}")
@get
op readWidget(@path widgetId: int32): Widget | NotFound;
```

### `tspconfig.yaml`

```yaml
emit:
  - typespec-http-zod
options:
  typespec-http-zod:
    emitter-output-dir: "{project-root}/src/generated"
```

Then run `tsp compile .`.

### `src/generated/schemas.gen.ts` (generated)

```ts
export const widgetSchema = z.object({
	id: z.string(),
	name: z.string().min(1),
	quantity: z.number().int().min(0),
});

export const notFoundSchema = z.object({
	code: z.string(),
	message: z.string(),
});

export const readWidgetPath = z.object({
	widgetId: z.preprocess(decodeNumber, z.number().int()),
});

export const readWidgetResponses = [
	{ status: 200, schema: widgetSchema },
	{ status: 404, schema: notFoundSchema },
] satisfies readonly ResponseArm[];
```

Path and query values arrive as strings. The emitted validator decodes `"1"` to `1` before the
schema runs, so hand the raw values straight in.

### `src/index.ts`

```ts
import { armFor, type ResponseArm } from "typespec-http-zod/runtime";
import { readWidgetPath, readWidgetResponses } from "./generated/schemas.gen.js";

function respond(arms: readonly ResponseArm[], status: number, body: unknown) {
	const arm = armFor(arms, status);
	if (arm === undefined) throw new Error(`no declared arm for ${status}`);
	return { status, body: arm.schema === undefined ? undefined : arm.schema.parse(body) };
}

export function readWidget(params: Record<string, unknown>, widget: unknown | undefined) {
	const parsed = readWidgetPath.safeParse(params);
	if (!parsed.success) return { status: 400, body: parsed.error.issues };

	return widget === undefined
		? respond(readWidgetResponses, 404, { code: "not_found", message: "no such widget" })
		: respond(readWidgetResponses, 200, widget);
}
```

`armFor` resolves which arm governs a status, applying OpenAPI's precedence: an exact code first,
then a range such as `4XX`, then `default`.

## What it emits

| file                   | contents                                                                                                                                                          | emitted when                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `schemas.gen.ts`       | component schemas, per-operation path, query, header, body and response validators, and the response arms                                                         | always                        |
| `requests.gen.ts`      | framework-free TypeScript types, with no imports: the models, and every operation's input, success bodies and result (`WireInputs`, `WireOutputs`, `WireResults`) | `contracts-output-dir` is set |
| `vocabularies.gen.ts`  | each enum's members as a runtime tuple                                                                                                                            | `contracts-output-dir` is set |
| `wire-contract.gen.ts` | assertions pairing the emitted Zod against those types                                                                                                            | that and `contracts-package`  |

`wire-contract.gen.ts` is not imported by any other file. The file contains type-level assertions
pairing each generated validator with its contract type, so a mismatch between the two is a compile
error. TypeScript reaches the file through `tsconfig`'s `include`, which has two consequences worth
knowing before removing it: dependency scanners report the file as unused, and deleting it does not
break the build until the validator and the contract type diverge.

Identifiers are named from the operation id the document publishes. An operation inside a namespace
carries the whole id, so `op readWidget` in `namespace Widgets` becomes `Widgets_readWidgetPath`.

Every component the document publishes is declared under its name - `widgetSchema` and `Widget` -
including the types no operation reaches, which openapi3 publishes at `All`, and those no route
names, such as a model a merge holds. A type used only by an operation the document leaves out -
one whose path holds a query string, or an `@overload` on its base operation's endpoint - is
declared too, as its validators are emitted. A component carries a visibility suffix,
`WidgetCreate`, only where its type is used at more than one visibility, as openapi3 names it. Four
names cannot be TypeScript's, and are not: a namespace is dropped, as one module has one, so two
types of one name in two namespaces are `duplicate-declaration`; a character an identifier cannot
hold is written `_`, `Hy-phen` as `Hy_phen`, and a name TypeScript refuses for a declaration - a
reserved word, a predefined type such as `string`, a strict-mode word such as `public`, a type
operator such as `keyof` - or a name the generated files declare or name for themselves takes a
trailing `_` - `delete_`, `string_`, `WireReader_`, `ArrayBuffer_`; and
a scalar is validated inline wherever it is used, since TypeScript cannot carry its constraints. A
model named `Record`, `Promise`, `Readonly` or `Exclude` keeps its name - the copy a visibility
template makes of a `Record<T>` instance, which openapi3 publishes as `Record`, included - and every
generated file names the library's type as `globalThis.Record<...>`. A type published only as a
reference to another document, by `@useRef`, is refused as `unsupported-type`: the document states
no schema for it.

## Docs

- [Guides](docs/guides.md): installing, validating a request, answering with the right body, content
  types, and building an emitter on the API.
- [Reference](docs/reference.md): every option, every diagnostic, and the known limits.
- [Oracles](docs/oracles.md): every artefact this emitter produces, and what compares it to the
  thing it has to agree with.
- [Releasing](docs/releasing.md): why this package publishes first, and how to rehearse a
  two-package release against a local registry.

## Licence

MIT
