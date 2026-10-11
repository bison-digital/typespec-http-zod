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
see a validation library. `WireInputs["op"]` is each operation's input as a caller supplies it, and what
its handler receives is assignable to it: a model body merged with the parameters, any other body under
its parameter's name, a binary `bytes` body as a `ByteStream | null`, and `Record<string, never>` for an
operation that takes nothing. A property with a default is optional here, because a caller may leave it
out, though the handler always receives it.
`keyof WireInputs` is every operation the service declares. `WireResults["op"]` is its result: one
member per declared response, each a `{ status, body, headers }` pairing a status with its own body,
which is what a backend reached over a service binding returns and a server emitter's handler can hand
straight on. `WireOutputs["op"]` is just the success bodies. `wire-contract.gen.ts` asserts the emitted
Zod accepts exactly those types, and needs `contracts-package` as well, naming the specifier the types
are imported from.

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

## Upgrading

### To `0.28.0`

**Most changes here are to `requests.gen.ts`, the framework-free contract types.** Four reach a server
emitter's handlers whether or not contracts are emitted, because they change what `EmittedRoute`
publishes:

- a body declared only under media types nothing can parse, such as a model as `application/xml` or a
  `string | int32` as `text/plain`, is handed over as the text that arrived, under its parameter's
  name, and is not validated;
- a model body that sends a key a parameter also has is named rather than merged;
- a media type declared with a parameter or in capitals, such as `application/json; charset=utf-8`, is
  JSON, so its body is placed and validated as JSON;
- an `@encode`d response header's type is its encoded type: `number` for
  `@encode(DurationKnownEncoding.seconds, int32)`, where it was `string`.

#### An optional property is `?: T`

The contract types now state the validator's input exactly. A plain optional property is `?: T`, and
only a property with a default keeps `?: T | undefined`, because `.default(v)` accepts an explicit
`undefined` and fills `v`:

```ts
// before
interface Thing {
	id: string;
	note?: string | undefined;
	count?: number | undefined;
}
// now (note is plain, count has a default)
interface Thing {
	id: string;
	note?: string;
	count?: number | undefined;
}
```

Under `exactOptionalPropertyTypes`, code that assigns `{ note: maybe }` where `maybe` may be
`undefined` now fails to compile. It was a value the validator refused: a handler returning it answered
`500`. Write the conditional spread, which assigns to the exact type:

```ts
const thing: Thing = { id, ...(maybe === undefined ? {} : { note: maybe }) };
```

The spread covers one property. A value whose own type declares `?: T | undefined` further down, such
as an envelope's `meta.correlationid`, fails at that depth, and `TS2375` names the path. Declare that
type's optional properties `?: T` as well, and the value assigns whole. Where the type cannot change,
the conversion has to leave the key out at every depth, because the validator refuses a present
`undefined`.

A widening helper has to be deleted wherever it stood in for the old `?: T | undefined`:

- one that widened a side so the two surfaces compared equal, such as a `Loosen<T>` adding
  `| undefined` to `openapi-typescript`'s output, now makes the comparison fail;
- a value of a widened type no longer assigns to the contract (`TS2375`).

A widening on a type that only receives a contract value, such as a parameter, still compiles. It
admits a value the validator refuses, so delete it as well.

#### `WireInputs["op"]` is the handler's input

A body the merge cannot express is named, exactly as a server emitter names it. That is a union,
array, indexed model, scalar, enum, optional or optional multipart body:

```ts
// op createCharge(@path id: string, @body body: Charge): Thing;
// before
type CreateChargeInput = Charge & { id: string };
// now
WireInputs["createCharge"]; // { id: string; body: Charge }
```

A model body is still merged. **Delete any code that flattened a handler's input to reach a backend
typed by the old contract**: the two now agree, and the flattening is the bug. Where a backend's own
port takes the body and its parameters as one object, merge them where it is called,
`{ ...input.body, id: input.id }`, and type a raw body read for itself as `WireInputs["op"]["body"]`,
not as the whole input.

**A model body that sends a key a parameter also has is named too.** Merged, one value replaced the
other and the handler saw only the body's: `POST /accounts/1/entries` with `{ "accountId": 2 }` in
the body handed the handler `accountId: 2`, so the entry landed on the account the BODY named while
any check made on the path saw account 1. The handler now receives both:

```ts
// op add(@path accountId: int64, @body body: Entry): Entry;   // Entry has accountId
// before: { accountId: number; amountMinor: number; ... }      // the path's accountId was lost
// now:    { accountId: number; body: Entry }                   // input.accountId is the path's
```

A read-only property is not in the body sent, so `@path id` beside a model whose `id` is
`@visibility(Lifecycle.Read)` collides with nothing and still merges. The body is under its `@body`
parameter's name, so for `@body body: Entry` read `input.body.x` where a handler read `input.x`, and
decide which of the two values the operation means. **Typecheck before you ship it:** a build that
bundles without typechecking, as `wrangler deploy` does, compiles a handler still reading `input.x`,
which is then `undefined`.

Every operation is keyed, so `keyof WireInputs` is every operation the service declares. One that takes
no input is `Record<string, never>`. A hand-kept list of the operations it used to leave out can be
deleted.

A type that told operations with an input from those without by asking `K extends keyof WireInputs`
no longer separates them: every operation is a key now. An operation with no input takes `{}`, which
is what the generated route passes it, so pass `{}` where such a type had you pass `undefined`.

A binary `bytes` body is a `ByteStream`, the stream the server hands over unread. It was an
`ArrayBuffer`. A platform `ReadableStream<Uint8Array>` is assignable to it, so a handler's input can be
forwarded to a backend as it is.

**The per-operation aliases are gone.** `CreateChargeInput` and its kind collided with the request
models specs give the same names. Use `WireInputs["createCharge"]`.

#### `WireOutputs` and `WireResults`

`WireOutputs["op"]` is every success body the operation declares: a union where it has several,
`undefined` for one with no body, and `never` where nothing succeeds. It was the lowest status's body
alone.

`WireResults["op"]` is new: the operation's result, one member per declared response, each a
`{ status, body, headers }` pairing a status with its own body. A backend typed by it can say whether
it answered `200` or `201`, and a handler can return what it returns:

```ts
interface Backend {
	scheduleDeletion(input: WireInputs["scheduleDeletion"]): Promise<WireResults["scheduleDeletion"]>;
}
```

A hand-written result type such as `{ status: number; body: T }` can be deleted.

A model served under a media type that is not JSON, such as `application/xml`, is `string` in both:
the text the producer serialises, which is what a server hands over and sends. It was
`Produced<Model>`. The model is still declared, so an import of it keeps working.

A binary response body is `Uint8Array<ArrayBuffer>` among its alternatives, which needs TypeScript 5.7
or later.

#### A model named after an emitted helper gets a trailing `_`

`ByteStream`, `Produced`, `ResponseArm`, `Simplify`, `WireInputs`, `WireOutputs` and `WireResults` are
declared by the emitted files themselves. A model with one of those names is now declared with a
trailing `_`, as a reserved word already was. Before, it failed to compile, or for the lookups merged
silently into them.

#### An `Http.File` body reaches the handler

A file upload is a raw body under its parameter's name, with the media type it was sent as under
`"Content-Type"`, and a download is a binary arm. Both were dropped: the handler was handed `{}`, and a
download was served empty.

#### A spec with more than one `@service` gets contracts per service

Where two or more services write to the top-level `contracts-output-dir`, each writes to
`<dir>/<ServiceName>`. Point each service's imports at its own directory. A package specifier given
as `contracts-package` has to be set per service, under `services`. A service that is the only one
writing there, the others naming their own `contracts-output-dir` under `services`, writes where it
did, and nothing changes for it.

#### TypeSpec 1.17

The optional `@typespec/streams` and `@typespec/versioning` peers admit `^0.87.0`.

### To `0.27.0`

**Nothing here reaches you until you ask for it.** A `^0.x` range pins the minor, so `^0.26.0` never
resolves `0.27.0`. You move when you choose to.

**Enable the linter while you are here.** The ReDoS check is an opt-in rule now, because the spec is
valid and the emitted regex is the published one, and TypeSpec reserves automatic diagnostics for a
program its library cannot serve:

```yaml
# tspconfig.yaml
linter:
  extends:
    - "typespec-http-zod/recommended"
```

#### A declared integer width is enforced

All ten integer scalars used to emit `z.number().int()`, which means "an integer in the safe range"
and nothing more. Measured at the wire:

| the caller sends       | before | now |
| ---------------------- | ------ | --- |
| `uint8` = `10`         | 200    | 200 |
| `uint8` = `255`        | 200    | 200 |
| `uint8` = `-5`         | 200    | 400 |
| `uint8` = `100000`     | 200    | 400 |
| `int32` = `3000000000` | 200    | 400 |

Nothing in your spec changes. What to check is whether any caller relies on sending a value outside a
width you declared; if a field genuinely holds a wider range, declare the wider type.

**A client generated from your document will not agree with your server on this**, and that is worth
knowing before you upgrade. `@typespec/openapi3` publishes a width as `format: uint8` with no bounds,
and JSON Schema 2020-12 makes `format` an annotation, so Ajv and most generators accept `-5` happily.
The server refuses it. Before this release both accepted it and both were wrong; now the server is
right and the document cannot say so. This cannot be fixed here: the document is upstream's.

#### A `@pattern` is compiled with the Unicode flag

A JSON Schema `pattern` is an ECMA-262 expression and a reader compiles it with `u`. This package
emitted a bare `/.../`, so `\p{L}` was an identity escape for the letter `p` rather than a Unicode
property, and the server ran a different expression from the one your document publishes.

The flag is carried wherever the pattern compiles under it. Two things follow:

- **`\p{...}` now means what it says.** If you wrote one, it was matching the literal characters
  before and is matching the property now.
- **`.` and quantifiers count code points, not UTF-16 units.** `^.{3}$` accepts `a<emoji>b` now and
  refused it before. This is the document's own reading, so it is a fix, but it is a change.

Measured across the 18 distinct patterns in the specs on hand: none failed to compile under the
flag, and none answered differently on the values tried, ASCII or astral. The change bites where a
pattern counts characters or names a property, not across the board. A pattern the flag cannot
compile keeps the bare form
and raises `non-unicode-pattern`; the remedy is to remove the backslash that was never needed, such
as a `\-` outside a character class.

**Grep for `@pattern(` will not find them all.** A pattern held in a `const` and referenced by name
is the easy one to miss.

#### A `@pattern` containing a forward slash now emits a module that parses

`^\/api\/v[0-9]+$` used to emit a regex literal that ended early, so the generated module was a
syntax error, from a compile that reported success. If you avoided slashes in patterns because of it,
you no longer need to.

#### A numeric bound on a value `@encode(string)` carries as text is dropped

`@encode(string) @minValue(10) capacity: int32` emitted `z.string().min(10)`, a check on how many
characters the value has: it refused `"42"`, which your spec permits. The exclusive form emitted a
call that does not exist on a string schema, so the module threw on import.

The bound is now dropped and `unenforceable-encoded-bound` names it. A value the old length check
refused is now accepted, and a value below the bound is accepted too: the document publishes
`minimum` on a `type: string` schema, which JSON Schema says does not apply, so enforcing it would
refuse what your published contract accepts. Declare the bound as a `@pattern`, which the document
publishes and every caller can read.

#### Two types with one name are refused

`duplicate-declaration` is an error, and it is raised from the schema walk now as well as the
contract walk. Before, two namespaces each declaring `Thing` emitted `export const thingSchema`
twice: `tsc` answered `TS2451` and `tsp compile` reported success.

It fires **per emitted file**. A program whose services are partitioned into their own output
directories is unaffected even where two of them share a model name; measured on four specs with
twelve such collisions between them, none was refused. If you do compile colliding names into one
output, rename one or give it `@friendlyName`.

#### A reference cycle with no declaration on it is refused

`model Box<T> { next?: Box<T> }` used as `Box<string>` used to exhaust the stack and report "Emitter
crashed! This is a bug." It now raises `inline-cycle`, matching what `@typespec/openapi3` raises on
the same spec. The remedy is `@friendlyName`, which now really does give the instantiation a name.

#### `@friendlyName` on an instantiation changes emitted names

It used to do nothing here while `@typespec/openapi3` published a component for it. A named
instantiation is now a declaration and emits `stringBoxSchema` beside the document's `stringBox`. If
you import generated schema names directly, check them.

#### `compile-schemas` no longer compiles any member of a reference cycle

Only the deferred declaration was left uncompiled before, which was enough on zod 4.5 and not on
4.6, where the failure moved to the schema that references it and threw at first parse. No action;
the emitted output changes for recursive models under that option.

## Building an emitter on this API

`emitHttpZod` returns one `EmittedService` per `@service`. `EmittedService.schemaNames` maps each
operation id to the identifiers its validators were declared under, so a wrapping emitter imports
names rather than agreeing about them.

```ts
import { emitHttpZod } from "typespec-http-zod";

export async function $onEmit(context: EmitContext) {
	const services = await emitHttpZod(context);

	for (const service of services) {
		for (const route of service.routes) {
			const names = service.schemaNames.get(route.operationId);
			// names.path, names.query, names.header, names.body, names.arms, names.responses
			// names.selectedAccept: the `accept` literal a negotiated operation's handler receives
			// route.responses: each declared status with its body, media types and headers
		}
	}
}
```

The files this package writes import no runtime: `schemas.gen.ts` declares the arm shape it annotates
its response lists with. A wrapping emitter that writes beside them - a server, a tool surface - owns
whatever its own files import, so two emitters pointed at one output directory write a byte-identical
`schemas.gen.ts` whenever their options match.

`EmitterOptionsSchema` is published so a wrapping emitter can derive its option contract rather than
restate it.
