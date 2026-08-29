import { createTypeSpecLibrary, type JSONSchemaType, paramMessage } from "@typespec/compiler";

/**
 * The library definition, kept in its own module so `tsp-index.ts` and the emitter can both reach it
 * without importing each other.
 */

export interface EmitterOptions {
	/**
	 * Where the framework-free contract types go, when they should not sit beside the validators.
	 *
	 * A second output directory rather than a path relative to `emitter-output-dir`, because the two
	 * artefacts often belong to different packages on purpose: the Zod lives beside the server that
	 * runs it, and the shared type lives wherever the rest of the codebase can import it **without
	 * importing the server**. Resolving one from the other with `../../..` would encode a particular
	 * layout in the emitter, which is the sort of thing that breaks silently when a package moves.
	 *
	 * Omitted, the contract types are simply not emitted - the emitter stays usable in a project that
	 * wants validators and nothing else.
	 */
	"contracts-output-dir"?: string;
	/**
	 * The package specifier the emitted Zod and wire assertions import their shared types from.
	 *
	 * **There is deliberately no default.** It used to default to one repository's own package
	 * name, so a consumer who configured nothing got validators importing from a package they had
	 * never heard of - output that looks right and does not resolve. There is no honest default for
	 * "the caller's own package", so the absence is the answer: with no package named, an enum is
	 * emitted inline and the output depends on nothing.
	 */
	"contracts-package"?: string;
	/**
	 * Whether a model closed in the spec becomes a validator that REJECTS an undeclared property,
	 * rather than one that strips it.
	 *
	 * **Set this to whatever `@typespec/openapi3`'s `seal-object-schemas` is set to.** The two
	 * emitters answer the same question about the same models, and this one cannot read the other's
	 * configuration. Left mismatched, the published document and the runtime disagree about whether a
	 * property may exist - and the direction matters: sealing here while the document stays silent
	 * gives callers a `400` on a payload the contract permits.
	 *
	 * Defaults to `false`, which is openapi3's own default, so the two agree until somebody changes
	 * one of them. A model that says `...Record<never>` is closed either way; that is the spec
	 * stating it outright rather than an emitter option deciding.
	 */
	"seal-object-schemas"?: boolean;
	/**
	 * Whether every emitted validator is wrapped in `z.compile()`.
	 *
	 * **A pre-compiled schema parses the same values to the same results, only faster.** Zod walks the
	 * schema once and emits a flat, loop-free function through `new Function`, then falls back to the
	 * ordinary parser for anything it cannot handle - so errors, parsed output and JSON Schema
	 * serialisation are unchanged. Measured on an emitted five-property model at zod 4.5.2:
	 * `safeParse` goes from 371 ns to 51 ns.
	 *
	 * **Off by default, because it is a trade rather than a free win.** Compilation happens at module
	 * scope, so it costs startup time in proportion to the number of schemas, and buys nothing until
	 * enough requests arrive to pay that back. Measured on two emitted modules at zod 4.5.2: 25
	 * declarations in 3.3 ms and 73 in 5.7 ms, so 0.08-0.13 ms each depending on how much the schema
	 * does. A service with several hundred operations should expect tens of milliseconds, which is a
	 * real share of a Cloudflare Worker's startup budget - measure it there rather than assuming the
	 * rate holds. It also needs
	 * `new Function`, which a CSP or no-eval environment refuses; Zod degrades to the uncompiled
	 * schema there rather than throwing, so setting this is never unsafe, merely sometimes pointless.
	 *
	 * **On Cloudflare Workers this is the only route to a compiled schema.** `new Function` is
	 * permitted during a Worker's STARTUP phase (`allow_eval_during_startup`, the default from
	 * compatibility date 2025-06-01) and module scope is startup, so wrapping here works. Zod's own
	 * `import "zod/compile"` does not: it compiles on first PARSE, which happens inside a request,
	 * where the runtime refuses. Only the emitter owns the module scope these schemas are built in.
	 *
	 * A recursive model emits `z.lazy()`, which cannot be compiled. Zod returns it uncompiled and it
	 * goes on parsing normally, so the option is safe to set on any spec.
	 */
	"compile-schemas"?: boolean;
	/**
	 * Models whose PROPERTY NAMES are also emitted as a runtime tuple.
	 *
	 * **For a key set that is a contract fact but cannot be a `Record` key type.** TypeSpec has no
	 * key-constrained `Record` and OpenAPI's `propertyNames` is unreachable from it, so a closed set
	 * of attribute names is stated by naming the properties - which publishes the constraint, and
	 * leaves a consumer that needs the set at RUN time with nothing to iterate, because a generated
	 * type is not a value. Naming the model here writes the keys beside the types as well.
	 *
	 * **An option rather than a decorator, and the distinction is the whole point.** It changes no
	 * schema, states nothing in the document and enforces nothing - it selects an output. A mark in
	 * the spec that no document carries is what got this package's last four decorators deleted; see
	 * `tsp-index.ts`.
	 *
	 * A name matching no model is reported, not ignored: a vocabulary that is silently absent is
	 * indistinguishable from one that is empty.
	 */
	"key-vocabularies"?: string[];
	/**
	 * The specifier the generated files import their runtime contract from. Defaults to
	 * `typespec-http-zod/runtime`.
	 *
	 * **This is here because the emitted response arms are annotated, and the annotation earns its
	 * keep.** `schemas.gen.ts` declares what each operation may answer with as
	 * `... satisfies readonly ResponseArm[]`. Measured against the alternative: `as const` needs no
	 * import at all, and catches a wrong `status` - but it is **blind** to a misspelled or omitted
	 * `schema`, because `schema: undefined` is legitimate for a bodyless response. The typo then
	 * produces a valid-looking arm that validates nothing, which is the failure this package exists to
	 * prevent. `satisfies` reports both, at the declaration, naming the key.
	 *
	 * An emitter built on this library points the default at its own runtime, which re-exports these
	 * names; an application that substitutes its own result or context types points it at its own
	 * module and re-declares them. That is also what makes the emitted output loadable from this
	 * package's own tests, where the package name does not resolve.
	 */
	"runtime-module"?: string;
	/**
	 * The command that regenerates these files, written into every banner.
	 *
	 * **`DO NOT EDIT` says what not to do and not what to do instead.** Only the project knows whether
	 * that is `pnpm generate`, `npm run api` or a `tsp compile` with three flags, so no emitter can
	 * supply it, and the generic line standing in its place lost the one thing a reader opening a
	 * generated file needs. Omitted, the generic line is kept.
	 */
	"regenerate-hint"?: string;
	/**
	 * Per-`@service` overrides, keyed by the service namespace name.
	 *
	 * Two surfaces in one spec do not have to share a destination - an internal API and a public one
	 * typically publish to different packages, and the public one is built against by people who must
	 * never receive the internal shapes. Falling back to the top-level values keeps a single-service
	 * project configured exactly as if this key did not exist.
	 */
	services?: Record<
		string,
		{
			"output-dir"?: string;
			"contracts-output-dir"?: string;
			"contracts-package"?: string;
			"seal-object-schemas"?: boolean;
			"compile-schemas"?: boolean;
			"key-vocabularies"?: string[];
			"runtime-module"?: string;
			"regenerate-hint"?: string;
		}
	>;
}

/**
 * **Exported, because an emitter built on this library must DERIVE its option schema from this
 * one rather than restate it.** A server emitter adds its own keys and forwards the rest; two schemas
 * that have to agree are two lists that will not, and the failure is silent - an option the consumer
 * sets, the wrapping emitter rejects as unknown, or accepts and never passes on.
 */
export const EmitterOptionsSchema: JSONSchemaType<EmitterOptions> = {
	type: "object",
	additionalProperties: false,
	properties: {
		"contracts-output-dir": { type: "string", nullable: true },
		"contracts-package": { type: "string", nullable: true },
		"seal-object-schemas": { type: "boolean", nullable: true },
		"compile-schemas": { type: "boolean", nullable: true },
		"key-vocabularies": { type: "array", items: { type: "string" }, nullable: true },
		"runtime-module": { type: "string", nullable: true },
		"regenerate-hint": { type: "string", nullable: true },
		services: {
			type: "object",
			nullable: true,
			additionalProperties: {
				type: "object",
				additionalProperties: false,
				properties: {
					"output-dir": { type: "string", nullable: true },
					"contracts-output-dir": { type: "string", nullable: true },
					"contracts-package": { type: "string", nullable: true },
					"seal-object-schemas": { type: "boolean", nullable: true },
					"compile-schemas": { type: "boolean", nullable: true },
					"key-vocabularies": { type: "array", items: { type: "string" }, nullable: true },
					"runtime-module": { type: "string", nullable: true },
					"regenerate-hint": { type: "string", nullable: true },
				},
				required: [],
			},
			required: [],
		},
	},
	required: [],
};

/**
 * What this emitter refuses, and why each refusal is a **diagnostic** rather than an exception.
 *
 * **A thrown error abandons the compile and names no source.** Every refusal here was once
 * `throw new UnsupportedTypeError(...)`, which reaches the user as
 * `Emitter "..." crashed! This is a bug. Please contact library author` - wrong on both counts when the
 * spec asked for something the emitter has decided not to represent. Measured across a 65-scenario
 * corpus, four scenarios failed and a deliberate refusal (`never` has no runtime representation), a
 * design limit and a genuine stack overflow were **indistinguishable**: all three arrived as the same
 * "crashed" banner.
 *
 * A diagnostic points at the offending declaration, carries a code somebody can search for and
 * suppress, and - because reporting does not unwind - lets the walk continue and report *every*
 * problem in one compile rather than the first one it meets.
 *
 * **Internal invariant violations stay exceptions**, deliberately: `noteExternalImport` called
 * outside its collector is a bug in this library, has no source span to point at, and must not be
 * suppressible by the person writing the spec.
 */
const diagnostics = {
	/*
	 * `unsupported-scalar` was declared here and has been RETIRED. A scalar with no known base is not
	 * unrepresentable: `@typespec/openapi3` publishes `scalar Mystery;` as the empty schema `{}`, which
	 * asserts nothing and therefore accepts everything. Refusing it emitted `z.never()`, the exact
	 * inversion - measured, `"hello"`, `42` and `null` all rejected. Both walks now emit the faithful
	 * reading, `z.unknown()` and `unknown`, and openapi3 raises no diagnostic so neither does this.
	 */
	"unsupported-type": {
		severity: "error",
		messages: {
			default: paramMessage`Cannot emit ${"artefact"} for ${"kind"}: ${"why"}. Replace it with a type a value can inhabit. ${"remedy"}`,
		},
	},
	"unsupported-default": {
		severity: "error",
		messages: {
			default: paramMessage`Cannot emit a default value of ${"why"}. Scalars, arrays and objects are emitted as literals; a default built by a scalar constructor has no literal form. Replace it with a literal value, or drop the default and let the property be optional. The property keeps its declared shape and loses only the fallback.`,
		},
	},
	/**
	 * **A default on a REQUIRED property, where the default can never apply.**
	 *
	 * **`default` is an annotation and `required` is the assertion**, and this emitter used to
	 * implement the opposite. JSON Schema 2020-12 section 9.2 makes `default` an annotation keyword
	 * with no effect on validation, and `@typespec/openapi3` implements exactly that:
	 * `#requiredModelProperties` builds the `required` list from `metadataInfo.isOptional` alone and
	 * never consults a default, then attaches the default beside it as a plain `schema.default`. The
	 * parameter side is the same rule spelled differently, `required: !param.optional`.
	 *
	 * So `basis: string = "s1159"` publishes as REQUIRED with an annotation nothing can reach. This
	 * emitter emitted `.default("s1159")`, which makes the field optional on the way IN - a validator
	 * accepting a request the document generated beside it forbids. OAI/OpenAPI-Specification#1543 is
	 * closed COMPLETED on this exact question, with the JSON Schema editor's answer that writing a
	 * default in before validating "is **NOT** part of validation", and the OpenAPI maintainer's that
	 * a default beside `required` "risks making the `required` notion invalid and encourages clients
	 * to unnecessarily send `default` values over the wire". Swagger's own documentation lists the
	 * combination as one of the two common mistakes with the keyword.
	 *
	 * **A WARNING, and this package's first, because the spec is representable.** `unsupported-default`
	 * used to be an error on composite literals and was retired for precisely this reason: refusing a
	 * construct `@typespec/openapi3` emits makes the same spec representable by one emitter and not the
	 * other, which is the one thing a differential between the two cannot tolerate. openapi3 emits this
	 * one, so this emitter serves it - saying what the document says, and saying out loud that the
	 * annotation is dead. The fix is one character and the message names it.
	 *
	 * The predicate is the DOCUMENT's, `metadataInfo.isOptional`, so this fires exactly where openapi3
	 * writes the name into `required` - including the PATCH position, where an update body's properties
	 * are optional and a default on one of them is live rather than dead.
	 */
	"default-on-required-property": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"name"}' is required, so its default can never apply: a required property is never absent. The OpenAPI document publishes it in 'required' and carries the default only as an annotation, and this validator does the same - a request omitting '${"name"}' is refused. Declare it optional, '${"name"}?: ... = ...', if callers may omit it.`,
		},
	},
	/**
	 * **A discriminated union whose discriminator the document never publishes.**
	 *
	 * `@discriminated(#{envelope: "none"})` puts the discriminator inside the variant on the wire -
	 * `{kind: "cat", ...Cat}` - and `@typespec/openapi3` emits `oneOf: [Cat, Dog]` with a
	 * `discriminator` keyword while never adding that property to the variant schema. OpenAPI 3.1
	 * forbids exactly this: "the `discriminator` field MUST be a required field". So the published
	 * contract cannot require the property, and under `seal-object-schemas` it forbids it outright.
	 *
	 * **Confirmed upstream, not inferred here:** `microsoft/typespec#7141`, open since 2025-04-27,
	 * labelled `[Bug]` / `design:needed` / `emitter:openapi3` and filed by a maintainer against these
	 * exact shapes. Nothing here needs raising; the refusal stands until that lands.
	 *
	 * **Refused rather than compensated for, and that distinction is the whole point.** This
	 * emitter did briefly inject the discriminator itself - the validator was right, the document was
	 * wrong, and it was recorded as a "declared divergence" with a warning and a committed list. That
	 * is a custom track with a label on it: runtime behaviour derived from nothing the document
	 * states. A validator may only enforce what the contract says.
	 *
	 * **It is avoidable, and the message says how.** Declaring the discriminator on the variant -
	 * `model Cat { kind: "cat"; ... }` - makes openapi3 publish it as required, and everything works
	 * with no divergence and no refusal. The refusal lands only on the spelling that cannot produce
	 * an honest contract.
	 */
	"undeclared-discriminator": {
		severity: "error",
		messages: {
			default: paramMessage`'${"name"}' serialises with '${"property"}' inside each variant, but '${"variant"}' does not declare it - so the OpenAPI document omits it, which OpenAPI 3.1 forbids for a discriminator ("the discriminator field MUST be a required field"). Emitting a validator that required it anyway would enforce a rule the published contract does not state. Declare '${"property"}' on '${"variant"}'.`,
		},
	},
	"empty-union": {
		severity: "error",
		messages: {
			default: paramMessage`A union with no representable variants (${"why"}) has nothing to validate against. Declare at least one variant this emitter can walk, or replace the union with the single type it reduces to.`,
		},
	},
	/*
	 * `circular-model` was declared here and has been RETIRED, because it refused something that can
	 * be represented. It fired on a cycle whose path holds no object property - a union variant or a
	 * dictionary value - on the grounds that a getter needs a property to sit on. True, and beside the
	 * point: `z.lazy()` needs no property, and deferring the whole declaration is where the laziness
	 * goes once nothing smaller can hold it. See `registry.ts` for the measurements, including why the
	 * fix needs a structural type and an annotation rather than `z.lazy()` alone.
	 */
	/**
	 * A `key-vocabularies` entry naming no model in the service.
	 *
	 * **Reported rather than ignored, because the failure mode is silence.** The option exists so a
	 * consumer can iterate a closed key set at run time; a typo would emit no tuple at all, and "the
	 * vocabulary is missing" looks exactly like "the vocabulary is empty" at the point it is used.
	 */
	/**
	 * Two services sealing differently, which `@typespec/openapi3` cannot mirror.
	 *
	 * An error rather than a warning, on the same footing as every other divergence here: the output
	 * is a document and a validator that contradict each other about whether a property may exist,
	 * and shipping that is worse than failing the build.
	 */
	"unmirrorable-seal": {
		severity: "error",
		messages: {
			default: paramMessage`'seal-object-schemas' resolves to true for ${"sealed"} and false for ${"open"}, and '@typespec/openapi3' has no per-service options - it applies one value to the whole program. So one of these services would publish a document that disagrees with the validator emitted beside it. Give every service the same value, or split the surfaces into separate compiles.`,
		},
	},
	"unknown-key-vocabulary": {
		severity: "error",
		messages: {
			default: paramMessage`'${"name"}' is listed in 'key-vocabularies' but service '${"service"}' declares no model of that name, so no key tuple would be emitted for it. Check the spelling, or remove it from the option.`,
		},
	},
	/**
	 * A status RANGE that OpenAPI cannot key.
	 *
	 * **This replaced `mixed-error-bodies`, which was a different refusal for the same scenario and
	 * the wrong diagnosis of it.** That one said "a service must answer every failure with one body
	 * shape" - an assumption this emitter no longer makes, since each declared response resolves its
	 * own body. What is genuinely unrepresentable is narrower and is not ours: OpenAPI keys a range as
	 * `1XX`...`5XX`, so `@minValue(494) @maxValue(499)` has nowhere to go.
	 *
	 * **Refused because `@typespec/openapi3` refuses it**, with the same rule copied from its
	 * `rangeToOpenAPI`. Bucketing `494-499` into `4XX` anyway would make a server claim a `400`
	 * carries that body - a rule no document states, because openapi3 declines to publish a document
	 * for this spec at all. The same source is then either representable by both emitters or neither,
	 * which is the only arrangement under which a differential between them means anything.
	 *
	 * A range that covers a bucket exactly - `@minValue(400) @maxValue(499)` - is supported and emits
	 * a `4XX` arm.
	 */
	"unsupported-status-code-range": {
		severity: "error",
		messages: {
			default: paramMessage`Status code range '${"start"}' to '${"end"}' cannot be published: OpenAPI can only key a range as 1XX, 2XX, 3XX, 4XX or 5XX, so no document states what this response carries and no validator may be emitted for it. Cover a whole group (\`@minValue(400) @maxValue(499)\` for 4XX) or declare the codes individually.`,
		},
	},
	/**
	 * An explicit `@operationId` another operation already answers to.
	 *
	 * **Derived ids are deduplicated and this one cannot be.** `resolveOperationId` names an operation
	 * from its immediate parent container, so two interfaces of the same name collide, and openapi3
	 * resolves that by appending `_2`. It does NOT do so for an explicit `@operationId`: that id is
	 * returned exactly as written and is never reserved, because the author asked for that name and
	 * renaming it silently would break every client generated against the document.
	 *
	 * So a colliding explicit id is a document OpenAPI forbids, `operationId` must be unique, and
	 * openapi3 raises nothing and publishes the duplicate. Every declaration here is keyed on the id,
	 * so the emitted file declares each name twice and fails with `TS2451: Cannot redeclare
	 * block-scoped variable` from a compile that reported success.
	 *
	 * **This is the one collision worth refusing.** The derived case is representable and is emitted.
	 * This one cannot be resolved without contradicting what the author explicitly wrote.
	 */
	"duplicate-operation-id": {
		severity: "error",
		messages: {
			default: paramMessage`'${"operationId"}' is already the operation id of another operation, and OpenAPI requires it to be unique. An explicit '@operationId' is never renamed to make room, so this cannot be resolved for you. Give this operation an id no other operation uses, or remove the '@operationId' and let it be derived.`,
		},
	},
	/**
	 * Two declarations claiming one TypeScript name with different bodies.
	 *
	 * **A repeat of the SAME declaration is not this and is dropped silently.** Visibility projection
	 * hands the registry a different `Type` object for one declared model, so a model reached under two
	 * visibilities is registered twice and renders identically; emitting both produced two
	 * byte-identical `export interface BodyModel` and a file that does not compile.
	 *
	 * This is the other case: one name, two different shapes. The document distinguishes them by
	 * namespace and a TypeScript module cannot, so keeping the first would publish a contract for a
	 * type nothing checks, and picking either is a guess about which the author meant.
	 */
	"duplicate-declaration": {
		severity: "error",
		messages: {
			default: paramMessage`Two different types are both named '${"name"}', and a TypeScript module cannot declare one name twice. The document tells them apart by namespace; this file cannot. Give one of them a different name, or set an explicit one with '@friendlyName'.`,
		},
	},
} as const;

export const $lib = createTypeSpecLibrary({
	name: "typespec-http-zod",
	diagnostics,
	emitter: { options: EmitterOptionsSchema },
});

export const { reportDiagnostic } = $lib;
