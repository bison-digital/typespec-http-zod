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
	 * Omitted, the contract types are simply not emitted — the emitter stays usable in a project that
	 * wants validators and nothing else.
	 */
	"contracts-output-dir"?: string;
	/**
	 * The package specifier the emitted Zod and wire assertions import their shared types from.
	 *
	 * ⚠️ **There is deliberately no default.** It used to default to one repository's own package
	 * name, so a consumer who configured nothing got validators importing from a package they had
	 * never heard of — output that looks right and does not resolve. There is no honest default for
	 * "the caller's own package", so the absence is the answer: with no package named, an enum is
	 * emitted inline and the output depends on nothing.
	 */
	"contracts-package"?: string;
	/**
	 * Whether a model closed in the spec becomes a validator that REJECTS an undeclared property,
	 * rather than one that strips it.
	 *
	 * ⚠️ **Set this to whatever `@typespec/openapi3`'s `seal-object-schemas` is set to.** The two
	 * emitters answer the same question about the same models, and this one cannot read the other's
	 * configuration. Left mismatched, the published document and the runtime disagree about whether a
	 * property may exist — and the direction matters: sealing here while the document stays silent
	 * gives callers a `400` on a payload the contract permits.
	 *
	 * Defaults to `false`, which is openapi3's own default, so the two agree until somebody changes
	 * one of them. A model that says `...Record<never>` is closed either way; that is the spec
	 * stating it outright rather than an emitter option deciding.
	 */
	"seal-object-schemas"?: boolean;
	/**
	 * Models whose PROPERTY NAMES are also emitted as a runtime tuple.
	 *
	 * ⚠️ **For a key set that is a contract fact but cannot be a `Record` key type.** TypeSpec has no
	 * key-constrained `Record` and OpenAPI's `propertyNames` is unreachable from it, so a closed set
	 * of attribute names is stated by naming the properties — which publishes the constraint, and
	 * leaves a consumer that needs the set at RUN time with nothing to iterate, because a generated
	 * type is not a value. Naming the model here writes the keys beside the types as well.
	 *
	 * ⚠️ **An option rather than a decorator, and the distinction is the whole point.** It changes no
	 * schema, states nothing in the document and enforces nothing — it selects an output. A mark in
	 * the spec that no document carries is what got this package's last four decorators deleted; see
	 * `tsp-index.ts`.
	 *
	 * A name matching no model is reported, not ignored: a vocabulary that is silently absent is
	 * indistinguishable from one that is empty.
	 */
	"key-vocabularies"?: string[];
	/**
	 * Per-`@service` overrides, keyed by the service namespace name.
	 *
	 * Two surfaces in one spec do not have to share a destination — an internal API and a public one
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
			"key-vocabularies"?: string[];
		}
	>;
}

/**
 * ⚠️ **Exported, because an emitter built on this library must DERIVE its option schema from this
 * one rather than restate it.** A server emitter adds its own keys and forwards the rest; two schemas
 * that have to agree are two lists that will not, and the failure is silent — an option the consumer
 * sets, the wrapping emitter rejects as unknown, or accepts and never passes on.
 */
export const EmitterOptionsSchema: JSONSchemaType<EmitterOptions> = {
	type: "object",
	additionalProperties: false,
	properties: {
		"contracts-output-dir": { type: "string", nullable: true },
		"contracts-package": { type: "string", nullable: true },
		"seal-object-schemas": { type: "boolean", nullable: true },
		"key-vocabularies": { type: "array", items: { type: "string" }, nullable: true },
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
					"key-vocabularies": { type: "array", items: { type: "string" }, nullable: true },
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
 * ⚠️ **A thrown error abandons the compile and names no source.** Every refusal here was once
 * `throw new UnsupportedTypeError(...)`, which reaches the user as
 * `Emitter "…" crashed! This is a bug. Please contact library author` — wrong on both counts when the
 * spec asked for something the emitter has decided not to represent. Measured across a 65-scenario
 * corpus, four scenarios failed and a deliberate refusal (`never` has no runtime representation), a
 * design limit and a genuine stack overflow were **indistinguishable**: all three arrived as the same
 * "crashed" banner.
 *
 * A diagnostic points at the offending declaration, carries a code somebody can search for and
 * suppress, and — because reporting does not unwind — lets the walk continue and report *every*
 * problem in one compile rather than the first one it meets.
 *
 * **Internal invariant violations stay exceptions**, deliberately: `noteExternalImport` called
 * outside its collector is a bug in this library, has no source span to point at, and must not be
 * suppressible by the person writing the spec.
 */
const diagnostics = {
	"unsupported-scalar": {
		severity: "error",
		messages: {
			default: paramMessage`Cannot emit ${"artefact"} for scalar '${"name"}': this emitter has no rule for it. Give it a known base with 'extends', or encode it with '@encode'.`,
		},
	},
	"unsupported-type": {
		severity: "error",
		messages: {
			default: paramMessage`Cannot emit ${"artefact"} for ${"kind"}: ${"why"}.`,
		},
	},
	"unsupported-default": {
		severity: "error",
		messages: {
			default: paramMessage`Cannot emit a default value of ${"why"}. Only scalar defaults and empty collections are representable.`,
		},
	},
	/**
	 * ⚠️ **A discriminated union whose discriminator the document never publishes.**
	 *
	 * `@discriminated(#{envelope: "none"})` puts the discriminator inside the variant on the wire —
	 * `{kind: "cat", ...Cat}` — and `@typespec/openapi3` emits `oneOf: [Cat, Dog]` with a
	 * `discriminator` keyword while never adding that property to the variant schema. OpenAPI 3.1
	 * forbids exactly this: "the `discriminator` field MUST be a required field". So the published
	 * contract cannot require the property, and under `seal-object-schemas` it forbids it outright.
	 *
	 * ⚠️ **Confirmed upstream, not inferred here:** `microsoft/typespec#7141`, open since 2025-04-27,
	 * labelled `[Bug]` / `design:needed` / `emitter:openapi3` and filed by a maintainer against these
	 * exact shapes. Nothing here needs raising; the refusal stands until that lands.
	 *
	 * ⚠️ **Refused rather than compensated for, and that distinction is the whole point.** This
	 * emitter did briefly inject the discriminator itself — the validator was right, the document was
	 * wrong, and it was recorded as a "declared divergence" with a warning and a committed list. That
	 * is a custom track with a label on it: runtime behaviour derived from nothing the document
	 * states. A validator may only enforce what the contract says.
	 *
	 * **It is avoidable, and the message says how.** Declaring the discriminator on the variant —
	 * `model Cat { kind: "cat"; … }` — makes openapi3 publish it as required, and everything works
	 * with no divergence and no refusal. The refusal lands only on the spelling that cannot produce
	 * an honest contract.
	 */
	"undeclared-discriminator": {
		severity: "error",
		messages: {
			default: paramMessage`'${"name"}' serialises with '${"property"}' inside each variant, but '${"variant"}' does not declare it — so the OpenAPI document omits it, which OpenAPI 3.1 forbids for a discriminator ("the discriminator field MUST be a required field"). Emitting a validator that required it anyway would enforce a rule the published contract does not state. Declare '${"property"}' on '${"variant"}'.`,
		},
	},
	"empty-union": {
		severity: "error",
		messages: {
			default: paramMessage`A union with no representable variants (${"why"}) has nothing to validate against.`,
		},
	},
	/**
	 * ⚠️ **Most cycles are not this.** A recursive model is an ordinary construct — `@typespec/openapi3`
	 * publishes a self-`$ref` and the document is valid — so it is emitted as a reference, deferred
	 * behind a getter on the property that closes the loop. This diagnostic is for the remainder: a
	 * cycle whose path holds **no object property**, and so has nowhere to put that getter. A named
	 * union whose variant refers back to a model still being rendered is the reachable case.
	 *
	 * Reported rather than thrown so the walk names every such cycle instead of dying inside the
	 * first — and, before the getters existed, so an inline cycle produced this rather than a
	 * `RangeError: Maximum call stack size exceeded`.
	 */
	"circular-model": {
		severity: "error",
		messages: {
			default: paramMessage`'${"name"}' closes a cycle through a declaration that cannot defer it — a union variant or a dictionary value, neither of which is a property a getter can sit on, so the emitted schema would read itself while initialising. Route the cycle through a model property, or break it in the spec.`,
		},
	},
	/**
	 * A `key-vocabularies` entry naming no model in the service.
	 *
	 * ⚠️ **Reported rather than ignored, because the failure mode is silence.** The option exists so a
	 * consumer can iterate a closed key set at run time; a typo would emit no tuple at all, and "the
	 * vocabulary is missing" looks exactly like "the vocabulary is empty" at the point it is used.
	 */
	"unknown-key-vocabulary": {
		severity: "error",
		messages: {
			default: paramMessage`'${"name"}' is listed in 'key-vocabularies' but service '${"service"}' declares no model of that name, so no key tuple would be emitted for it. Check the spelling, or remove it from the option.`,
		},
	},
	/**
	 * A status RANGE that OpenAPI cannot key.
	 *
	 * ⚠️ **This replaced `mixed-error-bodies`, which was a different refusal for the same scenario and
	 * the wrong diagnosis of it.** That one said "a service must answer every failure with one body
	 * shape" — an assumption this emitter no longer makes, since each declared response resolves its
	 * own body. What is genuinely unrepresentable is narrower and is not ours: OpenAPI keys a range as
	 * `1XX`…`5XX`, so `@minValue(494) @maxValue(499)` has nowhere to go.
	 *
	 * ⚠️ **Refused because `@typespec/openapi3` refuses it**, with the same rule copied from its
	 * `rangeToOpenAPI`. Bucketing `494-499` into `4XX` anyway would make a server claim a `400`
	 * carries that body — a rule no document states, because openapi3 declines to publish a document
	 * for this spec at all. The same source is then either representable by both emitters or neither,
	 * which is the only arrangement under which a differential between them means anything.
	 *
	 * A range that covers a bucket exactly — `@minValue(400) @maxValue(499)` — is supported and emits
	 * a `4XX` arm.
	 */
	"unsupported-status-code-range": {
		severity: "error",
		messages: {
			default: paramMessage`Status code range '${"start"}' to '${"end"}' cannot be published: OpenAPI can only key a range as 1XX, 2XX, 3XX, 4XX or 5XX, so no document states what this response carries and no validator may be emitted for it. Cover a whole group (\`@minValue(400) @maxValue(499)\` for 4XX) or declare the codes individually.`,
		},
	},
} as const;

export const $lib = createTypeSpecLibrary({
	name: "typespec-http-zod",
	diagnostics,
	emitter: { options: EmitterOptionsSchema },
});

export const { reportDiagnostic } = $lib;
