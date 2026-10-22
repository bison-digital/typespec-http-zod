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
	 * **There is deliberately no default.** A default package name would leave a project that
	 * configured nothing with validators importing from a package it has never heard of - output that
	 * looks right and does not resolve. There is no honest default for "the caller's own package", so
	 * the absence is the answer: with no package named, an enum is emitted inline and the output
	 * depends on nothing.
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
	 * does.
	 *
	 * **Measured at scale rather than extrapolated:** a generated 580-operation service (58 models,
	 * 1218 declarations, 638 of them compiled) evaluates its schema module in ~93 ms uncompiled and
	 * ~132 ms compiled - so about **40 ms of extra startup**, roughly a tenth of a Cloudflare Worker's
	 * 400 ms startup budget. It boots and serves on `workerd` at that size with the fast path live. It also needs
	 * `new Function`, which a CSP or no-eval environment refuses; Zod degrades to the uncompiled
	 * schema there rather than throwing, so setting this is never unsafe, merely sometimes pointless.
	 *
	 * **On Cloudflare Workers this is the only route to a compiled schema.** `new Function` is
	 * permitted during a Worker's STARTUP phase (`allow_eval_during_startup`, the default from
	 * compatibility date 2025-06-01) and module scope is startup, so wrapping here works. Zod's own
	 * `import "zod/compile"` does not: it compiles on first PARSE, which happens inside a request,
	 * where the runtime refuses. Only the emitter owns the module scope these schemas are built in.
	 *
	 * No member of a reference CYCLE is compiled. Compiling one that a `z.lazy()` body names throws
	 * `Cannot read properties of undefined (reading '_zod')` on the first parse from zod 4.6 onwards, so
	 * the whole cycle is left uncompiled and goes on parsing normally. The option stays safe to set on
	 * any spec.
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
	 * the spec that no document carries is why this package declares no decorators; see
	 * `tsp-index.ts`.
	 *
	 * A name matching no model is reported, not ignored: a vocabulary that is silently absent is
	 * indistinguishable from one that is empty.
	 */
	"key-vocabularies"?: string[];
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
	 * Two surfaces in one spec do not have to share a destination: each can publish its validators
	 * and contract types to a package of its own. Falling back to the top-level values keeps a
	 * single-service project configured exactly as if this key did not exist.
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
			default: paramMessage`Cannot emit ${"artefact"} for ${"kind"}: ${"why"}. Replace or remove the declaration: ${"remedy"}`,
		},
	},
	/**
	 * **A default that is no value the position accepts.** openapi3 publishes a default as the JSON it
	 * serializes, beside a schema the default need not satisfy - an encoding can change the type
	 * under it, a constraint can rule out the literal it names, a key it sets can be one the position
	 * does not declare. Filled in, it handed the handler a value its own type refuses, and the module
	 * did not compile. A warning, because the property itself is still validated as the document
	 * says; only the fallback is dropped.
	 */
	"invalid-default": {
		severity: "warning",
		messages: {
			default: paramMessage`The default of '${"name"}' is not emitted: ${"why"}, so filling it in would hand the handler a value the property refuses. Replace it with a value the property accepts, or remove it.`,
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
	 * So `sort: string = "asc"` publishes as REQUIRED with an annotation nothing can reach. This
	 * emitter emitted `.default("asc")`, which makes the field optional on the way IN - a validator
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
			discriminator: paramMessage`'${"name"}' is a discriminator, which '@typespec/openapi3' always publishes in its base's 'required', so it is required here however it is declared and its default can never apply. The validator refuses a value omitting it, as the document does. Remove the '?' and the default.`,
			ancestor: paramMessage`'${"name"}' is required by a declaration of its key above it, which the document holds the value to through 'allOf', so it is required here however it is declared and its default can never apply. The validator refuses a value omitting it, as the document does. Remove the '?' and the default, or make the declaration above optional.`,
		},
	},
	/**
	 * **A doc comment the compiler truncated, so the description this emitter passes on is cut short.**
	 *
	 * **An unescaped `@` in a doc comment begins a doc tag, and everything from there to the end of
	 * the comment leaves the description.** Measured against `@typespec/compiler@1.15.0` through its
	 * own parser: `parseDocContent` breaks its loop on `Token.At` outside a code fence, and the
	 * doc-mode scanner turns every `@` into that token. `parseDocTag` then parses the remainder as a
	 * tag and, for a name it does not know, keeps it as `DocUnknownTag` - which `getDoc` never reads.
	 * No diagnostic is raised anywhere in that path.
	 *
	 * So it is not only `{@link}`. `support@example.com` in prose truncates at `support`, and
	 * "use @maxLength to bound it" truncates at "use", with no brace anywhere to notice. Nothing
	 * reports it, so it is otherwise found only by reading the emitted document by hand.
	 *
	 * **The check reads the AST, because the truncated string cannot answer.** By the time `getDoc`
	 * returns, the `@` is gone, so a check over the emitted text would find nothing to match - and
	 * pattern-matching emitted text is the thing this package refuses to decide anything by. The fact
	 * is on the node: a tag that is not `param`, `template`, `prop`, `returns`, `return` or `errors`
	 * parses as `DocUnknownTag`. That is exact, with no heuristic and no false positive on the four
	 * spellings that survive: a brace in prose, a backticked brace, `\{`, and `\@`.
	 *
	 * **Gated on the description actually coming from the comment**, via `getDocData().source`. A type
	 * carrying an `@doc(...)` decorator takes its description from there, where `@` inside a string
	 * literal means nothing, so warning would be a false positive - and a warning that fires on
	 * correct specs is one a consumer turns off wholesale.
	 *
	 * **A WARNING, for the reason `default-on-required-property` is one.** The spec is representable:
	 * `@typespec/openapi3` publishes the same truncated description happily, so refusing it would make
	 * one spec emit under one emitter and not the other. An error would also set `program.hasError()`
	 * and cost the whole document over one comment. What is wrong is not that it cannot be served, but
	 * that the author has written something that does not say what they meant.
	 *
	 * **Upstream this is intended, and the escape is sanctioned.** `microsoft/typespec#3374` reported
	 * exactly this, naming both `{@link}` and email addresses, and was closed as a duplicate of
	 * `#1358`, which is open on the Backlog. `#3375` then added the `\@` escape deliberately. So the
	 * remedy this message names is upstream's own, and only the silence is unaccounted for.
	 */
	"truncated-doc-comment": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"name"}' has a doc comment that stops at '@${"tag"}': an unescaped '@' begins a doc tag, so everything after it is dropped from the description this emitter and the OpenAPI document beside it both publish. Use '\\@${"tag"}' to escape it, wrap it in backticks, or set the description with '@doc(...)' instead.`,
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
			open: paramMessage`'${"name"}' serialises with '${"property"}' inside each variant, but '${"variant"}' declares it as no one fixed value, so nothing can tell its values from another variant's and no dispatch can hold it. Declare '${"property"}' on '${"variant"}' as the literal its variant name says.`,
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
	/**
	 * **A model a discriminated base's `mapping` names, which no dispatch can hold.**
	 *
	 * The mapping names a subtype for the values its discriminator fixes, and a dispatch reads one
	 * fixed value per subtype. A subtype whose discriminator is not fixed - `"lab" | string`, or `kind`
	 * renamed with `@encodedName` so its base's open `string` is what it publishes - made Zod throw
	 * "Invalid discriminated union option" on import or on the first parse. A subtype whose value a
	 * declaration above it refuses - `kind: "cobra"` under `@maxLength(3)` - is published as `allOf`
	 * that declaration, so no value is one, and was accepted.
	 *
	 * **An error, as `undeclared-discriminator` is**: the spec says something the document cannot
	 * hold as a dispatch, so it is refused rather than read some other way, and the base dispatches to
	 * its other subtypes until it is fixed.
	 */
	"invalid-subtype-discriminator": {
		severity: "error",
		messages: {
			default: paramMessage`'${"name"}' is named by the mapping of '${"base"}''s discriminator '${"property"}', and ${"why"}. Declare '${"property"}' on '${"name"}' as one fixed value that every declaration of '${"property"}' above it admits.`,
			invisible: paramMessage`'${"name"}' is named by the mapping of '${"base"}''s discriminator '${"property"}', and ${"why"}. Make '${"property"}' visible at '${"at"}' on '${"name"}' and every model above it that declares it: a value is told as a '${"name"}' by its '${"property"}'.`,
		},
	},
	/**
	 * **A template instance that adds properties to a base openapi3 seals.**
	 *
	 * openapi3 seals a model with no derived models it publishes, and does not count a template
	 * instance as one, so under `seal-object-schemas` `Pet<string> extends Animal` leaves `Animal`
	 * sealed. `Pet<string>` is published as `allOf` that sealed `Animal`, whose own
	 * `unevaluatedProperties` cannot see `Pet<string>`'s properties - so the document refuses every
	 * value carrying one. An error, because the published schema refuses what the spec declares, and
	 * no validator can agree with both.
	 */
	"sealed-base-extended": {
		severity: "error",
		messages: {
			default: paramMessage`'${"name"}' extends '${"base"}', which '@typespec/openapi3' seals under 'seal-object-schemas' because it does not count a template instance as a derived model. The document publishes '${"name"}' as 'allOf' the sealed '${"base"}', so it refuses every value carrying ${"keys"}, which '${"name"}' adds. Declare it as a model of its own with 'model ... is ${"name"}', which openapi3 counts as derived and so leaves '${"base"}' open.`,
		},
	},
	/**
	 * **A redeclared property no one validator can hold to both of its declarations.**
	 *
	 * openapi3 publishes a subtype as `allOf` its base, so a property the subtype redeclares must meet
	 * every declaration of it. Where the subtype's narrows the base's - a derived scalar, a model that
	 * extends it, a literal the base admits - the base's constraints are applied to the subtype's
	 * value. Where it does not - a model that only looks like the base's, a scalar that is not one of
	 * the base's - the value is held to two schemas, and intersecting them in Zod merged sealed
	 * objects' keys and threw on two defaults. Refused rather than read some other way.
	 */
	"unrepresentable-override": {
		severity: "error",
		messages: {
			default: paramMessage`'${"model"}' redeclares '${"name"}', which '${"base"}' declares as '${"declared"}', and ${"why"}: the document holds the value to both, and no one validator here can. Declare '${"name"}' on '${"model"}' as '${"declared"}', or as a type derived from it.`,
			recursive: paramMessage`'${"model"}.${"name"}' is held to '${"base"}.${"name"}' as well, through 'allOf', and merging the two declarations refers back to itself. This emitter declares no recursive merge, so the value is refused rather than validated against one of the two. Declare '${"name"}' on '${"model"}' as '${"declared"}', or as a type derived from it.`,
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
	 * own body. What is genuinely unrepresentable is narrower and is not this emitter's: OpenAPI keys
	 * a range as `1XX`...`5XX`, so `@minValue(494) @maxValue(499)` has nowhere to go.
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
	/**
	 * **A pattern the document's own readers cannot compile.**
	 *
	 * A JSON Schema `pattern` is an ECMA-262 expression, and a reader compiles it with the Unicode
	 * flag - Ajv does by default. Several ordinary spellings are an error under that flag: a redundant
	 * `\-` outside a character class, a lone `]` or `{`, an identity escape such as `\a`.
	 * Measured: Ajv throws `Invalid regular expression: /^\-?\d+$/u` on a pattern the emitted
	 * validator runs perfectly well, so the server enforces a rule nothing reading the document can.
	 *
	 * Reported rather than rewritten, for the same reason as every other pattern diagnostic: openapi3
	 * publishes the expression verbatim and this package does not edit a published contract. The
	 * remedy is a character the flag accepts, and it is almost always a `\` that was never needed.
	 */
	"non-unicode-pattern": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"pattern"}' is not a valid regular expression under the Unicode flag, which is how a JSON Schema reader compiles a published pattern: Ajv throws on it rather than evaluating it. The emitted validator falls back to running it without the flag, so this server enforces a rule no reader of its own document can. Remove the character the flag rejects: it is almost always a backslash that was never needed, such as a '\\-' outside a character class or an escape like '\\a', and otherwise a lone ']' or '{' that should be escaped.`,
		},
	},
	/**
	 * **A constraint `@encode` has moved onto a JSON type it does not apply to.**
	 *
	 * openapi3 applies a property's or a scalar's constraints and then lets the encoding replace
	 * `type`, so `@encode(string)` on a numeric property publishes `minimum` beside `type: string`,
	 * and `@encode("x", int32)` on a string publishes `pattern` beside `type: integer`. JSON Schema
	 * ignores each there, so the document asserts nothing, and the validator drops it too: applied,
	 * a numeric bound on text became a LENGTH check, and `.regex()` on an integer or `.min()` on a
	 * boolean threw when the module loaded. A default of the declared type under an encoding that
	 * changes it is the same case: it is no value of the encoded type.
	 *
	 * **A diagnostic, not a linter rule**, because here the emitter cannot do what the spec asks: it
	 * drops a rule the author wrote. That is the case TypeSpec reserves for `$onValidate`-style
	 * diagnostics, where a linter is for a program that is correct but could be better. It replaces
	 * `unenforceable-encoded-bound`, which reported numeric bounds on text and nothing else.
	 */
	"unenforceable-encoded-constraint": {
		severity: "warning",
		messages: {
			default: paramMessage`${"keywords"} on '${"name"}' is not emitted: '@encode' makes the wire value a JSON ${"type"}, and ${"keywords"} is written for the declared type. '@typespec/openapi3' publishes it beside 'type: ${"type"}', where JSON Schema ignores a keyword meant for another type and a default is no value of it, so a validator applying it would disagree with the published contract. Declare the rule in a form the encoded value carries, such as a '@pattern' on a string, or remove '@encode'.`,
		},
	},
	/**
	 * **A property whose wire name is `__proto__` is published, and no Zod validator can check it.**
	 *
	 * Zod skips a declared `__proto__` key on purpose, so prototype pollution cannot reach through a
	 * parse (colinhacks/zod#6386): a value of any type, or none, is accepted for it and dropped from
	 * the result. The document publishes it like any other property, and nothing emitted can enforce
	 * it - which is the case `unenforceable-encoded-constraint` reports for a constraint, for the same reason:
	 * the spec is representable, so refusing it would make it emit under one emitter and not the
	 * other, and serving it silently would leave a validator looser than its contract unsaid.
	 *
	 * The key is still DECLARED, as a computed `["__proto__"]`, because a plain `__proto__:` in an
	 * object literal sets the shape's prototype instead. Measured: that dropped the property from the
	 * published JSON Schema, and under `seal-object-schemas` refused every body carrying it as an
	 * unrecognised key - the opposite of what the document says.
	 */
	"unenforceable-property-name": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"name"}' is published as a property and cannot be validated: Zod skips a key named '__proto__' on purpose (colinhacks/zod#6386), so any value, or none, is accepted for it and dropped from the parsed result. The published schema still states it. Give it another wire name if its value has to be checked.`,
		},
	},
	/**
	 * **An optional property named after an `Object.prototype` member refuses every value that
	 * leaves it out.**
	 *
	 * Zod reads a property as `input[key]`, so an absent `constructor`, `toString`, `valueOf` or any
	 * other inherited member reads as the function every object inherits, and is refused as the wrong
	 * type (colinhacks/zod#6666, open). A required one is unaffected, because a value that leaves it
	 * out is refused either way. The emitted validators are right and inherit the defect - on
	 * requests and responses alike - and the only repair in emitted code, a `z.preprocess` onto a
	 * null-prototype copy, would cost the model `.shape` and `.extend`.
	 *
	 * Reported where the property is optional, which includes the PATCH position that makes a
	 * required property optional. When Zod ships the fix, the peer floor moves to it and this retires:
	 * `test/inheritednames` pins the defect so that release is noticed.
	 */
	"optional-prototype-name": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"name"}' is optional here, and the validator refuses every value that leaves it out: Zod reads an absent '${"name"}' as the member every object inherits from Object.prototype, a function, and rejects it (colinhacks/zod#6666). A value that carries '${"name"}' validates normally. Give it a wire name Object.prototype does not have, or declare it required, until Zod releases a fix.`,
		},
	},
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
	/**
	 * **A cycle that never passes through a declaration has nothing to reference itself by.**
	 *
	 * A recursive MODEL is fine: it earns a declaration, and the back edge becomes a getter or a
	 * `z.lazy()` naming that declaration. A cycle closing through a type this emitter INLINES has no
	 * such name. A template instantiation is the reachable case - `declaredNameOf` returns undefined
	 * for one, matching how `@typespec/openapi3` inlines it - so `model Box<T> { next?: Box<T> }` used
	 * as `Box<string>` walked into itself forever. Measured before this existed:
	 * `RangeError: Maximum call stack size exceeded`, reported by the compiler as "Emitter crashed!
	 * This is a bug."
	 *
	 * **An error, and the same error openapi3 raises.** It answers the identical spec with
	 * `@typespec/openapi3/inline-cycle` at severity error and writes no document, so there is no
	 * contract for a validator to agree with even if one could be emitted. The remedy it names works
	 * here for the same reason: `@friendlyName` gives the instantiation a name, which makes it a
	 * declaration, which gives the back edge something to point at.
	 */
	"inline-cycle": {
		severity: "error",
		messages: {
			default: paramMessage`'${"type"}' closes a reference cycle without passing through anything this emitter can declare, so the cycle has no name to reference itself by. A template instantiation is inlined rather than declared, exactly as '@typespec/openapi3' inlines it, and that emitter refuses the same spec with its own 'inline-cycle' error. Give the type a name with '@friendlyName' so it becomes a declaration, or break the cycle.`,
		},
	},
	/**
	 * **A body declared `never`.** The type has no values, so the body cannot exist, and
	 * `@typespec/openapi3` - whose body paths test only for `void` - publishes it as
	 * `content: { "application/json": { schema: {} } }`, any value at all. A validator could agree
	 * with the spec or with the document, not both, so the declaration is refused. `void` declares no
	 * body, and the document publishes it as none.
	 */
	"never-body": {
		severity: "error",
		messages: {
			default: paramMessage`'${"operationId"}' declares a ${"position"} body of type 'never', which has no values, and '@typespec/openapi3' publishes it as any JSON value. Replace it with 'void' to declare no body.`,
		},
	},
	/**
	 * **A `null` the OpenAPI 3.0 document cannot publish.** OAS 3.0.4: `nullable` "only takes effect if
	 * `type` is explicitly defined within the same Schema Object", and "Other Schema Object constraints
	 * retain their defined behavior, and therefore may disallow the use of `null`". `@typespec/openapi3`
	 * publishes `Inner | null` as `{ type: object, allOf: [Inner], nullable: true }`, `Color | null` as
	 * `{ allOf: [Color], nullable: true }` and `"a" | "b" | null` as `{ type: string, enum: [a, b],
	 * nullable: true }`, and each refuses `null` by that text; a bare `null` is `{ nullable: true }`,
	 * any value. Refused where openapi3 publishes 3.0, since a validator agreeing with the spec's
	 * `| null` disagrees with the document; at 3.1 each is `anyOf` with `{ type: "null" }`.
	 */
	"unpublishable-null": {
		severity: "error",
		messages: {
			default: paramMessage`'${"type"}' admits null, and the OpenAPI 3.0 document '@typespec/openapi3' publishes does not: ${"why"}. Set 'openapi-versions: ["3.1.0"]' under '@typespec/openapi3' in tspconfig.yaml's options, whether or not it is emitted, to publish OpenAPI 3.1, which says null.`,
		},
	},
	/**
	 * **A sealed model whose base is a record, where openapi3 publishes 3.0.** openapi3's 3.0 sealing
	 * is `additionalProperties: { not: {} }` beside the model's own `properties`, which cannot see the
	 * record its base declares in `allOf`, so the document refuses every key the record admits; 3.1
	 * seals with `unevaluatedProperties`, which can.
	 */
	"unpublishable-record": {
		severity: "error",
		messages: {
			default: paramMessage`'${"type"}' extends the record '${"base"}' and is sealed, and the OpenAPI 3.0 document '@typespec/openapi3' publishes seals it with 'additionalProperties: { not: {} }', which does not see the record in its 'allOf': every key the record admits is refused. Set 'openapi-versions: ["3.1.0"]' under '@typespec/openapi3', which seals with 'unevaluatedProperties', or spread the record onto the model, '...${"base"}', which is published open.`,
		},
	},
	/**
	 * **A required read-only property in a request, where openapi3 publishes 3.0 and a later version.**
	 * OAS 3.0.4 says such a `required` "will take effect on the response only"; 3.1 made `readOnly`
	 * an annotation, so `required` holds in a request too. One request validator cannot agree with both
	 * documents.
	 */
	"ambiguous-read-only": {
		severity: "error",
		messages: {
			default: paramMessage`'${"type"}' is sent in a request and holds the required read-only property '${"property"}', and '@typespec/openapi3' publishes OpenAPI 3.0, where a request may leave it out, and ${"later"}, where it must send it: a request validator agrees with only one. Set one version in 'openapi-versions', or declare the request's own view of it, '${"view"}', which openapi3 publishes without it.`,
		},
	},
	/**
	 * **An `@encode` whose published schema no value satisfies, or which states no type.**
	 *
	 * `@typespec/openapi3` keeps the declared type beside the encoded one, so `@encode("x", string)`
	 * on a model publishes `{ $ref: Filter, type: "string" }`: an object and a string at once, which
	 * nothing is. The same holds for a list model, an integer enum, or a string scalar encoded as
	 * `int32`. An encoding to a scalar outside the standard library publishes no `type` at all, which
	 * is also how two scalars whose `@encode` name each other once overflowed the stack. This emitter
	 * validated the encoded scalar beside each, so a value the document refuses was accepted, or one
	 * it accepts refused.
	 *
	 * **An error, as `undeclared-discriminator` is**: the published contract is not one a validator
	 * can agree with, so the declaration is refused rather than read some other way, and the property
	 * validates nothing until the spec says what it means.
	 */
	"unsatisfiable-encoding": {
		severity: "error",
		messages: {
			default: paramMessage`'${"name"}' is declared '${"declared"}' and encoded as '${"encoded"}': ${"why"}. Encode it as a standard scalar its declared type admits, or remove '@encode'.`,
		},
	},
	/**
	 * **Two inputs of one operation handed to its handler under one key.**
	 *
	 * A handler's input is the path, query, header and cookie groups spread into one object, with the
	 * body merged or named beside them. `@header("x") a: string` beside `@query("x") b: int32` therefore
	 * reached the handler as one `x`, the header's string replacing the validated number, while the
	 * input was typed `number & string`. `@typespec/http` refuses only a path and a query parameter of
	 * one name; the rest compiled with no diagnostic.
	 *
	 * **A warning, because the spec is valid and openapi3 publishes it**: the parameters are distinct on
	 * the wire. It is the input this package states that cannot carry both, so the key is typed and
	 * validated as both declarations at once, and the contract types still compile. A server emitter
	 * reading `EmittedRoute.sharedInputKeys` declines to mount the operation.
	 */
	/**
	 * **Two header parameters whose names differ only in case**, which HTTP reads as one header and
	 * openapi3 publishes as two parameters of that one value. Refused; see `headerCaseCollisionOf`.
	 */
	"header-case-collision": {
		severity: "error",
		messages: {
			default: paramMessage`'${"operation"}' declares the header '${"first"}' and the header '${"second"}', which HTTP reads as one header - a header's name is case-insensitive - and openapi3 publishes as two parameters of the one value it carries. Neither is validated. Give one of them a different name.`,
		},
	},
	"shared-input-key": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"operation"}' takes the ${"first"} '${"key"}' and the ${"second"} '${"key"}', and a handler's input holds one value under each key, so '${"key"}' is stated as both declarations at once and accepts only a value satisfying both. Give one of them a different name.`,
			repeated: paramMessage`'${"operation"}' takes the ${"first"} '${"key"}' twice, and the document publishes only the first: the wire carries one value, which is validated and typed as the first declaration, and the second states nothing. Give one of them a different name.`,
		},
	},
	/**
	 * **A schema `@typespec/openapi3` publishes with its properties and its `required` read at two
	 * visibilities.** openapi3 writes a component from the first reference that reaches it; where that
	 * reference is a request's, and the model has nothing to reshape there, its `required` is read at
	 * `Read` and its properties at the request's visibility - a read-only property is then required and
	 * not declared, or, optional, left out - and every use of the component shares it. Refused rather
	 * than validated against a schema the document does not hold. See `publicationOf` in
	 * `published.ts` for the measured mechanism.
	 */
	"split-visibility": {
		severity: "error",
		messages: {
			default: paramMessage`'@typespec/openapi3' publishes '${"name"}' as ${"via"} first reaches it: there it reads the properties of ${"model"} at '${"at"}' and its 'required' at 'Read', so ${"property"} is ${"effect"}, in every use of '${"name"}'. Refused rather than validated against a schema the document does not hold. Use the request's own view, which openapi3 publishes apart: ${"remedy"}.`,
			inherited: paramMessage`'${"name"}' holds ${"model"} through 'allOf', and '@typespec/openapi3' publishes ${"model"} as ${"via"} first reaches it: there it reads the properties of ${"model"} at '${"at"}' and its 'required' at 'Read', so ${"property"} is ${"effect"}, in every model holding it. Refused rather than validated against a schema the document does not hold. Use the request's own view, which openapi3 publishes apart: ${"remedy"}.`,
			inline: paramMessage`'@typespec/openapi3' publishes ${"model"} with its properties read at '${"at"}' and its 'required' at 'Read', so ${"property"} is ${"effect"}. Refused rather than validated against a schema the document does not hold. Use the request's own view, which openapi3 publishes apart: ${"remedy"}.`,
		},
	},
	/**
	 * **A `@oneOf` body sent as a URL-encoded form, where a member may read one text two ways and
	 * another member accepts one and not the other.** The document accepts the form where some
	 * reading of its text matches exactly one member, and which reading that is depends on every key
	 * and member - finding it means trying every combination, exponential in the keys, and a record's
	 * keys are the sender's to choose. Refused rather than validated by a reading the document need
	 * not take. See `ambiguousFormKeyOf`.
	 */
	"ambiguous-form-reading": {
		severity: "error",
		messages: {
			default: paramMessage`'${"operation"}' accepts the '@oneOf' '${"union"}' as a URL-encoded form, where '${"member"}' may read the text of ${"key"} as ${"first"} and as ${"second"}, and '${"other"}' accepts only the first. The document takes the form where some reading of its text matches exactly one member, and which reading that is depends on every key and member, so the body is not validated. Give ${"key"} one reading in '${"member"}', declare it alike in '${"other"}', or publish the union as 'anyOf' by removing '@oneOf'.`,
		},
	},
	"duplicate-declaration": {
		severity: "error",
		messages: {
			default: paramMessage`Two different types are both named '${"name"}', and a TypeScript module cannot declare one name twice. The document tells them apart by namespace; this file cannot. Give one of them a different name, or set an explicit one with '@friendlyName'.`,
			renamed: paramMessage`Two different types, '${"first"}' and '${"second"}', are both declared as '${"name"}': a character an identifier cannot hold is written '_', and a TypeScript module cannot declare one name twice, so neither is validated. Give one of them a different name, or set an explicit one with '@friendlyName'.`,
			multipart: paramMessage`'${"name"}' is a multipart body and the name of a schema that differs from it - the same model sent as JSON is one: openapi3 publishes one component under the name, and a TypeScript module cannot declare one name twice, so neither is validated. Send the multipart body as a model of its own.`,
			envelope: paramMessage`'${"name"}' is the name openapi3 gives an envelope of a '@discriminated' union, after the union and the variant, and the name of another type: a TypeScript module cannot declare one name twice, so neither is validated. Rename the type, the union or the variant.`,
			instances: paramMessage`Two instances of the template '${"name"}' are both named '${"name"}', as openapi3 names a union instance after its template alone: it refuses its own document for them as 'duplicate-type-name', and a TypeScript module cannot declare one name twice, so neither is validated. Declare a named union for each, or set an explicit name with '@friendlyName'.`,
			binary: paramMessage`'${"name"}' holds 'bytes' and is sent as a multipart part, where openapi3 publishes 'bytes' as any value, and used elsewhere, where it is a base64 string: openapi3 publishes both under the name and refuses its own document as 'duplicate-type-name', and a TypeScript module cannot declare one name twice, so neither is validated. Give the part a union of its own.`,
			cased: paramMessage`Two different types, '${"first"}' and '${"second"}', are both validated by '${"name"}': a validator is named for its type with the first letter lowered, and a TypeScript module cannot declare one name twice, so neither is validated. Give one of them a different name, or set an explicit one with '@friendlyName'.`,
			suffixed: paramMessage`'${"name"}' is the name openapi3 gives '${"first"}' at '${"at"}', a type it suffixes for being used at more than one visibility, and the name of '${"second"}': openapi3 refuses its own document for it as 'duplicate-type-name', and a TypeScript module cannot declare one name twice, so neither is validated. Rename '${"second"}', or set an explicit name with '@friendlyName'.`,
			visibility: paramMessage`'${"name"}' is the document's one name for two different schemas of one model, at '${"first"}' and at '${"second"}': openapi3 publishes both under it and refuses its own document as 'duplicate-type-name', and this module cannot declare one name twice, so neither is validated. ${"remedy"}`,
			context: paramMessage`'${"name"}' is published inside an explicit '@body', where '@typespec/http' ignores its metadata annotations and the document holds them as data, and outside one, where they are metadata: two shapes under one name, which '@typespec/openapi3' refuses too, as 'duplicate-type-name'. Mark the body '@bodyRoot', or give the body a model of its own.`,
		},
	},
} as const;

export const $lib = createTypeSpecLibrary({
	name: "typespec-http-zod",
	diagnostics,
	emitter: { options: EmitterOptionsSchema },
});

export const { reportDiagnostic } = $lib;
