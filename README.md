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

| file                   | contents                                                                                                  | emitted when                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `schemas.gen.ts`       | component schemas, per-operation path, query, header, body and response validators, and the response arms | always                        |
| `requests.gen.ts`      | framework-free TypeScript types, with no imports                                                          | `contracts-output-dir` is set |
| `vocabularies.gen.ts`  | each enum's members as a runtime tuple                                                                    | `contracts-output-dir` is set |
| `wire-contract.gen.ts` | assertions pairing the emitted Zod against those types                                                    | that and `contracts-package`  |

`wire-contract.gen.ts` is not imported by any other file. The file contains type-level assertions
pairing each generated validator with its contract type, so a mismatch between the two is a compile
error. TypeScript reaches the file through `tsconfig`'s `include`, which has two consequences worth
knowing before removing it: dependency scanners report the file as unused, and deleting it does not
break the build until the validator and the contract type diverge.

Identifiers are named from the operation id the document publishes. An operation inside a namespace
carries the whole id, so `op readWidget` in `namespace Widgets` becomes `Widgets_readWidgetPath`.

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
