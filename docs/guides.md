# Guides

## Installing

The emitter runs at build time. The generated files import `ResponseArm` as a type, which erases at
compile time, so a dev dependency is enough if that is all you use.

`./runtime` also exports `armFor`, which is a function. An application that calls it and installed
the package as a dev dependency will typecheck, build, and run in development, then fail on deploy:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'typespec-http-zod'
    imported from dist/server.js
```

Install it as a regular dependency if you call `armFor`.

## Emitting the contract types

`schemas.gen.ts` is emitted always. The other three files need somewhere to go:

```yaml
emit:
  - typespec-http-zod
options:
  typespec-http-zod:
    emitter-output-dir: "{project-root}/src/generated"
    contracts-output-dir: "{project-root}/src/generated"
```

`requests.gen.ts` holds plain TypeScript with no imports, so the types can cross layers that must not
see a validation library. `wire-contract.gen.ts` asserts the emitted Zod infers exactly those types,
and needs `contracts-package` as well, naming the specifier the types are imported from.

## Validating a request

Each operation gets a validator per request location, because a validator library checks one target
at a time and a caller needs to know which part of the request was wrong.

```ts
import { readWidgetPath, readWidgetQuery, createWidgetBody } from "./generated/schemas.gen.js";

const path = readWidgetPath.safeParse(request.params);
if (!path.success) return { status: 400, body: path.error.issues };
```

Path, query and header values arrive as strings. The emitted validator decodes the wire form before
the document's schema runs: `"1"` becomes `1` for an integer parameter, and `?tags=a,b,c` is split on
the delimiter the document's `style` implies. It decodes rather than coerces, so `?limit=` stays
empty and fails the schema rather than arriving as `0`. Hand the raw values straight in.

A `content-type` header is compared after its parameters are stripped, so
`multipart/form-data; boundary=...` matches the declared media type.

### Which schema validates a body

An operation's body validator is named `<operationId>Body`. Where the body is a declared model, no
second name is minted and the component's own schema is the validator: `op createWidget(@body body:
WidgetCreate)` is validated by `widgetCreateSchema`. An operation with no `...Body` const is one
whose body is a named component.

## Answering with the right body

An operation can declare `404`, `4XX` and `default` at once, and all three describe a 404. OpenAPI
settles it: an explicit code takes precedence over a range, and `default` is every status not
otherwise listed. `armFor` applies that rule.

```ts
import { armFor, type ResponseArm } from "typespec-http-zod/runtime";

function respond(arms: readonly ResponseArm[], status: number, body: unknown) {
	const arm = armFor(arms, status);
	if (arm === undefined) throw new Error(`no declared arm for ${status}`);
	return { status, body: arm.schema === undefined ? undefined : arm.schema.parse(body) };
}
```

For an operation declaring all four arms:

| answered | arm chosen | body validated against |
| -------- | ---------- | ---------------------- |
| `200`    | `200`      | the success model      |
| `404`    | `404`      | `NotFound`             |
| `429`    | `4XX`      | `Throttled`            |
| `500`    | `default`  | `Unexpected`           |

`schema: undefined` on an arm means the document says that response carries no body.

## Content types

`EmittedRoute` carries `requestContentTypes` and `responseContentTypes`, the media types the document
states for each direction. A server uses them to choose how to read a body and how to negotiate a
response. A `bytes` body served as `application/octet-stream` or an image type is raw binary, and the
document publishes only `contentMediaType` for it, so no validator is emitted.

## Versioning

A spec using `@typespec/versioning` is projected to the version it currently serves before it is
walked, so an operation removed in a later version is not emitted and a property made optional is
optional. `@typespec/versioning` is an optional peer dependency, resolved behind a guarded import.

## Building an emitter on this API

`emitHttpZod` returns one `EmittedService` per `@service`. `EmittedService.schemaNames` maps each
operation id to the identifiers its validators were declared under, so a wrapping emitter imports
names rather than agreeing about them.

```ts
import { emitHttpZod } from "typespec-http-zod";

export async function $onEmit(context: EmitContext) {
	const services = await emitHttpZod(context, { defaultRuntimeModule: "my-emitter/runtime" });

	for (const service of services) {
		for (const route of service.routes) {
			const names = service.schemaNames.get(route.operationId);
			// names.path, names.query, names.header, names.body, names.response, names.responses
		}
	}
}
```

`defaultRuntimeModule` sets what generated files import from when the consumer sets no
`runtime-module`. A consumer's own setting still wins. Use it when your generated files import more
than `ResponseArm`, so they resolve against your package rather than this one.

`EmitterOptionsSchema` is published so a wrapping emitter can derive its option contract rather than
restate it.
