import {
	getDiscriminatedUnion,
	getDiscriminator,
	getEncode,
	resolveEncodedName,
	isNeverType,
	isTemplateDeclaration,
	type Enum,
	type Model,
	type ModelProperty,
	type Program,
	type Scalar,
	type Type,
	type Union,
	type Value,
} from "@typespec/compiler";
import { createMetadataInfo, isQueryParam, type MetadataInfo, Visibility } from "@typespec/http";
import { applyConstraints } from "./constraints.js";
import { reportDiagnostic } from "./lib.js";

/**
 * What a walk returns after reporting a refusal.
 *
 * **Reporting does not unwind, which is the point.** A throw abandoned the compile at the first
 * unrepresentable construct; reporting lets the walk carry on and name every one of them in a single
 * run. The walk still has to return a `string`, and `z.never()` is the honest placeholder: valid
 * Zod, rejects everything, and unreachable in practice because the error diagnostic has already
 * failed the compile that would have written it.
 */
const UNREPRESENTABLE = "z.never()";

/**
 * TypeSpec type -> Zod source text.
 *
 * **Deliberately partial, and it fails loudly rather than guessing.** A general TypeSpec->Zod
 * converter has to answer for every construct the language can express; this one only has to answer
 * for the constructs our own specs are allowed to use, which is what makes it a bounded problem
 * rather than an open-ended dependency (see the ADR on why `typespec-zod@0.0.0-68` is not in the
 * runtime path). Anything outside that set throws with the offending type named - an emitter that
 * silently produced `z.any()` for a construct it did not understand would push a hole all the way
 * into `respond()`, where the whole point is that drift is caught.
 */

/**
 * External module -> the constants the emitted schemas reference from it.
 *
 * Collected during emission rather than pre-scanned: only the enums actually reachable from an
 * operation should produce an import, and reachability is exactly what the walk already computes.
 *
 * **Scoped to one emission, not module-global-and-cleared.** The previous shape was a module
 * `Map` emptied by whoever read it first, which is correct only while there is exactly one service
 * and one read. A second `@service` namespace - a public surface beside an internal one - would
 * have merged one surface's imports into the other's file: an unused import if lucky, a missing one
 * if not. Neither is discoverable while there is only one service, so it is fixed before there are
 * two rather than found by them. Same save/restore idiom as {@link withRefResolver}.
 */
let externalImports: Map<string, Set<string>> | undefined;

/**
 * Enum name -> its declared members, for every vocabulary the surface actually reaches.
 *
 * The spec is the single source for these. A consumer's shared package used to hold them as tuples
 * and the spec merely *described* them for the document's benefit - two lists that agreed only by
 * inspection, and by the time this flipped, two of them did not: `PersonalAttribute` published four
 * of six values wrong (the charge-authentication answers an MR01 cannot be filed without) and
 * `SubmissionStatusCode` published all five wrong. Generating them removes the second list.
 */
let vocabularies: Map<string, readonly string[]> | undefined;

/**
 * Whether a model is SEALED - closed to properties nobody declared.
 *
 * **A property of the model's own shape, not of where it is used.** This was previously "the
 * model is reachable from a request body", computed by a whole-graph pre-pass. That rule is wrong in
 * a way that is invisible while it happens to agree: there is one declaration per model, so adding a
 * single operation that accepts `ProblemItem` in a body would flip `problemItemSchema` from
 * stripping to rejecting **in every response that uses it too**. Strictness would be decided by the
 * rest of the spec rather than by the model.
 *
 * **This mirrors `@typespec/openapi3`'s `shouldSealSchema` deliberately, line for line.** The
 * emitted validator and the published document have to answer the same question the same way, and
 * the only way to guarantee that is to ask it the same way - not to arrive at the same answer by a
 * different route and measure that they still agree. The exception for models with derived models is
 * theirs: sealing a base would make a subtype's own properties "unevaluated" against it.
 *
 * The one thing not mirrored is the `seal-object-schemas` option itself. openapi3 seals only when it
 * is on; a validator that refuses a property the document permits is wrong in the other direction,
 * so a consumer running with sealing off wants schemas that strip rather than reject. That is
 * `seal-object-schemas` in `EmitterOptions`, defaulting to openapi3's own default.
 */
function isSealed(model: Model): boolean {
	// `Record<never>` is closed whatever the option says - the spec has stated it outright, and
	// openapi3 seals it for the same reason.
	if (model.indexer !== undefined) return isNeverType(model.indexer.value);
	if (!sealObjectSchemas) return false;
	return !model.derivedModels.some(includeDerivedModel);
}

/**
 * Whether `@typespec/openapi3` is sealing object schemas for this compile.
 *
 * **This emitter cannot see the other emitter's options, so the consumer states it twice.**
 * Awkward, and the alternative is worse: assume sealing is on and a project running openapi3 with
 * its default gets validators that reject properties its published document permits. Whichever way
 * the two are configured, the conformance differential compares openness in both directions and
 * fails on a mismatch - so a project that sets one and forgets the other is told immediately rather
 * than shipping a contradiction.
 */
let sealObjectSchemas = false;

export function withSealedObjects<T>(sealed: boolean, run: () => T): T {
	const previous = sealObjectSchemas;
	sealObjectSchemas = sealed;
	try {
		return run();
	} finally {
		sealObjectSchemas = previous;
	}
}

/**
 * The visibility the current walk is emitting for - which decides what counts as HTTP metadata.
 *
 * Visibility decides **which** metadata applies: `@statusCode` is applicable to a response and not
 * to a request, so the same model projects differently in the two directions. `createMetadataInfo`
 * is the predicate `@typespec/openapi3` itself uses, so asking it is what keeps the two artefacts
 * from answering differently. Measured on `type/model/visibility`: openapi3 emits five components
 * for one model, and before this we emitted one carrying every lifecycle property at once.
 *
 * **Position is a SECOND axis, and this only handles the first.** `@header` is metadata at a
 * payload root and ordinary data nested inside a `@body`; `isPayloadProperty` takes a third
 * argument, `ignoreMetadataAnnotations`, which openapi3 threads as emitter context
 * (`schema-emitter.js:210`) and this does not pass. A metadata-carrying model used in **both**
 * positions therefore still loses the header property where the document keeps it.
 *
 * That shape is rare rather than theoretical: it raises `metadata-ignored` from `@typespec/http`,
 * which fires **zero** times across all 65 `@typespec/http-specs` scenarios,
 * and one variant of it makes openapi3 itself fail with `duplicate-type-name`. It is a real gap with
 * no known occurrence - recorded here rather than described as an incident, because it has not been
 * one.
 *
 * Scoped rather than threaded through six signatures, matching the idiom the rest of this module
 * already uses - the walk is deeply recursive and a parameter would have to be carried by every
 * function whether it cared or not.
 */
let visibility: Visibility = Visibility.Read;
let metadataInfo: MetadataInfo | undefined;

export function withVisibility<T>(program: Program, next: Visibility, run: () => T): T {
	const previousVisibility = visibility;
	const previousInfo = metadataInfo;
	visibility = next;
	metadataInfo ??= createMetadataInfo(program);
	try {
		return run();
	} finally {
		visibility = previousVisibility;
		metadataInfo = previousInfo;
	}
}

/** Whether a property is optional AT THE CURRENT POSITION - PATCH makes update fields optional. */
function isOptionalAt(program: Program, property: ModelProperty): boolean {
	metadataInfo ??= createMetadataInfo(program);
	return metadataInfo.isOptional(property, visibility);
}

/** Whether a property belongs in the BODY at the current position, rather than being metadata. */
function isPayloadProperty(program: Program, property: ModelProperty): boolean {
	metadataInfo ??= createMetadataInfo(program);
	return metadataInfo.isPayloadProperty(property, visibility);
}

/** Whether this model is shaped differently at `visibility` than at the canonical `Read`. */
export function isTransformedBy(program: Program, model: Model, at: Visibility): boolean {
	metadataInfo ??= createMetadataInfo(program);
	return metadataInfo.isTransformed(model, at);
}

/** The visibility the current walk is emitting for - the registry keys declarations on it. */
export function currentVisibility(): Visibility {
	return visibility;
}

/**
 * openapi3's own rule for which derived models count - `@typespec/openapi3`'s `util.ts`.
 *
 * A template declaration is not a real subtype, and neither is an uninstantiated template; both
 * would otherwise stop a base from being sealed for no reason a reader could see.
 */
function includeDerivedModel(model: Model): boolean {
	return (
		!isTemplateDeclaration(model) &&
		(model.templateMapper?.args === undefined ||
			model.templateMapper.args.length === 0 ||
			model.derivedModels.length > 0)
	);
}

/** Record an enum's members so the vocabularies artefact can be generated from them. */
function noteVocabulary(name: string, values: readonly string[]): void {
	vocabularies?.set(name, values);
}

/**
 * Record every enum a service DECLARES, not merely every one its success bodies happen to reach.
 *
 * **A vocabulary is a fact about the contract, not about a code path.** Collecting them during the
 * Zod walk meant an enum reachable only through an ERROR body was never emitted - which is exactly
 * what happened to one surface's error-code enum: declared in the spec, published on every
 * operation's failure responses, and absent from the generated vocabularies, so the one list a
 * consumer branches on had to be hand-written beside the generated ones. Walking declarations removes
 * the whole class rather than the instance.
 */
export function noteDeclaredVocabularies(enums: Iterable<Enum>): void {
	for (const target of enums) {
		noteVocabulary(
			target.name,
			[...target.members.values()].map((member) => String(member.value ?? member.name)),
		);
	}
}

/**
 * Record a named model's PROPERTY NAMES as a runtime vocabulary.
 *
 * **This exists because "a `Record` keyed by an enum" is inexpressible, and the workaround was
 * about to cost a duplicated list.** `ProfileAttributes` is 150-odd known keys; naming them in the
 * spec is what makes the published document state the constraint instead of hiding it behind a
 * hand-written predicate. But a *type* cannot be iterated, and more than one layer usually needs
 * the set at RUN time - so without this the keys would live in the spec AND as a hand-maintained
 * tuple in a shared package - one vocabulary stated twice, which is precisely the
 * drift the deleted predicate existed to prevent.
 *
 * **Selected by an emitter OPTION, deliberately not by a decorator.** A decorator would put a
 * mark in the spec that no document carries - the exact objection that deleted the last four. This
 * changes no schema, states nothing in the contract and enforces nothing; it decides which
 * convenience artefact gets written beside the types, which is what an emitter option is for.
 *
 * Wire names, like everything else here: the document publishes one name per property, and a
 * consumer checking a key against this tuple is checking what arrived.
 */
export function noteKeyVocabularies(
	program: Program,
	models: Iterable<Model>,
	wanted: readonly string[],
): string[] {
	const found: string[] = [];
	for (const model of models) {
		if (!wanted.includes(model.name)) continue;
		found.push(model.name);
		noteVocabulary(
			model.name,
			inheritedAndOwnProperties(model).map((property) => rawPropertyKey(program, property)),
		);
	}
	return found;
}

/** Record that the emitted schemas reference `name` from `module`. */
export function noteExternalImport(module: string, name: string): void {
	if (externalImports === undefined) {
		throw new Error(
			"typespec-http-zod: an external import was noted outside `collectExternalImports`. " +
				"Every walk must run inside one, or its imports land in another surface's file.",
		);
	}
	const names = externalImports.get(module) ?? new Set<string>();
	names.add(name);
	externalImports.set(module, names);
}

/**
 * Which package the generated Zod imports its vocabularies from - `undefined` when there is none.
 *
 * **Not a constant, and no longer defaulted.** Each `@service` publishes its own contracts
 * package, so a hardcoded specifier makes the second service's schemas import names that package
 * does not export. Scoped the same way the strict-model set is, so a nested emission cannot leak
 * into its parent.
 *
 * **It used to default to one repository's own package name.** A
 * consumer who configured nothing got validators importing `SPEC_VOCABULARIES` from a package they
 * had never heard of - output that looks right and does not resolve. There is no honest default for
 * "the caller's own package", so the absence is the answer: with no package named, an enum is
 * emitted inline and the output depends on nothing.
 */
let contractsPackageName: string | undefined;

const contractsPackage = (): string | undefined => contractsPackageName;

export function withContractsPackage<T>(name: string | undefined, run: () => T): T {
	const previous = contractsPackageName;
	contractsPackageName = name;
	try {
		return run();
	} finally {
		contractsPackageName = previous;
	}
}

/**
 * Run `walk` with a fresh import collector, and hand back what it referenced.
 *
 * Throwing rather than lazily creating the map is deliberate: a walk that runs outside a collector
 * is a wiring mistake whose only symptom would be a generated file missing an import, which the
 * emitted TypeScript reports as an undefined name far from the cause.
 */
export function collectExternalImports<T>(walk: () => T): {
	readonly result: T;
	readonly imports: Map<string, Set<string>>;
	readonly vocabularies: Map<string, readonly string[]>;
} {
	const previousImports = externalImports;
	const previousVocabularies = vocabularies;
	const imports = new Map<string, Set<string>>();
	const vocabulary = new Map<string, readonly string[]>();
	externalImports = imports;
	vocabularies = vocabulary;
	try {
		return { result: walk(), imports, vocabularies: vocabulary };
	} finally {
		externalImports = previousImports;
		vocabularies = previousVocabularies;
	}
}

/** Refuse `type`, pointing at its declaration, and carry on so the rest is reported too. */
function refuse(program: Program, type: Type, why: string): string {
	reportDiagnostic(program, {
		code: "unsupported-type",
		target: type,
		format: { artefact: "Zod", kind: type.kind, why },
	});
	return UNREPRESENTABLE;
}

/** Scalars we accept, and the Zod they become. Keyed by the TypeSpec scalar's declared name. */
const SCALARS: Readonly<Record<string, string>> = {
	string: "z.string()",
	boolean: "z.boolean()",
	bytes: "z.string()",
	int8: "z.number().int()",
	int16: "z.number().int()",
	int32: "z.number().int()",
	int64: "z.number().int()",
	safeint: "z.number().int()",
	uint8: "z.number().int()",
	uint16: "z.number().int()",
	uint32: "z.number().int()",
	uint64: "z.number().int()",
	integer: "z.number().int()",
	float: "z.number()",
	float32: "z.number()",
	float64: "z.number()",
	decimal: "z.number()",
	decimal128: "z.number()",
	numeric: "z.number()",
	/**
	 * Dates cross the wire as strings and are validated as strings.
	 *
	 * Not `z.iso.datetime()`: response schemas are permissive on purpose, and a
	 * stricter format check here would turn a producer emitting a legal-but-unexpected instant into a
	 * failed response for a caller who could have parsed it perfectly well.
	 */
	utcDateTime: "z.string()",
	offsetDateTime: "z.string()",
	plainDate: "z.string()",
	plainTime: "z.string()",
	duration: "z.string()",
	url: "z.string()",
};

function scalarToZod(program: Program, scalar: Scalar): string {
	// `scalar unixTimestamp32 is utcDateTime;` with `@encode(int32)` on the SCALAR, not on each use.
	const encoded = encodedTypeOf(program, scalar);
	if (encoded !== undefined && encoded !== scalar) {
		return applyConstraints(program, scalarToZod(program, encoded), scalar);
	}
	let current: Scalar | undefined = scalar;
	// Walk the `extends` chain so a named scalar (`scalar chNumber extends string`) resolves to the
	// primitive it is built on rather than being rejected for having a project-specific name.
	while (current !== undefined) {
		const mapped = SCALARS[current.name];
		// Constraints are read from the scalar the property NAMED, not from the primitive it resolves
		// to, so `@pattern(...) scalar TrimmedString extends string` carries its rules to every use.
		if (mapped !== undefined) return applyConstraints(program, mapped, scalar);
		current = current.baseScalar;
	}
	/**
	 * **A scalar with no known base is `z.unknown()`, and it used to be a refusal.**
	 *
	 * **`z.never()` was the exact inversion of what the document says.** `scalar Mystery;` is
	 * published by `@typespec/openapi3` as `"Mystery": {}` - the empty schema, which under JSON Schema
	 * asserts nothing and therefore accepts **everything**. This emitter refused the compile and, on the
	 * way, wrote `value: z.never()`, which accepts **nothing**. Measured against the emitted schema:
	 * `"hello"`, `42` and `null` were all rejected, so a service built on it would answer 400 to every
	 * request the document calls valid.
	 *
	 * Refusing was the wrong answer twice over: the document represents the spec perfectly, so under the
	 * governing rule this emitter must too - the same source has to be representable by both or by
	 * neither. And `z.unknown()` is not a guess, it is the precise reading of `{}`: a validator that
	 * enforces nothing is what a schema asserting nothing means.
	 *
	 * No diagnostic, because openapi3 raises none. Copying its rule includes copying its silence; a
	 * warning here would report a problem the published contract does not have. This is the same
	 * treatment a raw binary body already gets, for the same reason.
	 */
	return applyConstraints(program, "z.unknown()", scalar);
}

/**
 * A TypeSpec `enum` becomes a Zod enum over its member values, resolved through the generated
 * vocabulary constant so the document and the runtime cannot describe different sets.
 *
 * **`@externalValues` used to be able to point that arrow the other way** - the spec deferring to
 * a hand-written TypeScript tuple - and while it did, the members here described only the
 * *document*. It is gone, and the tuples are generated from the spec.
 */
function enumToZod(_program: Program, target: Enum): string {
	const values = [...target.members.values()].map((member) => member.value ?? member.name);
	if (values.some((value) => typeof value !== "string")) {
		return `z.union([${values.map((value) => `z.literal(${JSON.stringify(value)})`).join(", ")}])`;
	}
	/**
	 * Every string vocabulary resolves through the generated constant rather than being restated.
	 *
	 * The members are declared once, in the spec, and the vocabularies artefact is generated from them -
	 * so the document and the runtime cannot describe different vocabularies. This replaces the
	 * `@externalValues` decorator, which pointed the arrow the other way: the spec deferred to a
	 * hand-written TypeScript constant, which is the opposite of a spec being a source of truth.
	 */
	noteVocabulary(target.name, values as readonly string[]);
	/**
	 * Inline unless the consumer named a package to share the tuple through.
	 *
	 * The indirection exists so a SECOND package - another layer, a client - can branch on the same
	 * values without restating them. A consumer who has no such package wants a self-contained
	 * validator, and emitting a reference to one they never configured is the only way to get output
	 * that cannot resolve.
	 */
	const shared = contractsPackage();
	if (shared === undefined) {
		return `z.enum([${values.map((value) => JSON.stringify(value)).join(", ")}])`;
	}
	noteExternalImport(shared, "SPEC_VOCABULARIES");
	return `z.enum(SPEC_VOCABULARIES.${target.name})`;
}

/**
 * A union becomes `z.enum` when every variant is a string literal, and `z.union` otherwise.
 *
 * `null` variants are lifted out into `.nullable()` rather than emitted as a member, because
 * `z.union([z.string(), z.null()])` and `z.string().nullable()` differ in the error they produce and
 * the latter is what a reader expects.
 */
/**
 * Register a declaration the SPEC never wrote, under a name the document publishes.
 *
 * A `@discriminated` union with an envelope has no TypeSpec type for its wrapper - openapi3
 * synthesises one (`tk.model.create`, `schema-emitter.js:436`) and publishes it as
 * `PetWithEnvelopeCat`. The registry keys declarations on a `Type`, and there is no type to key on,
 * so this is the seam that lets one be declared by name instead. Falls back to inlining when no
 * registry is installed, which keeps the property-level walks working.
 */
let declareSynthetic: ((name: string, build: () => string) => string) | undefined;

export function withSyntheticDeclarations<T>(
	hook: (name: string, build: () => string) => string,
	run: () => T,
): T {
	const previous = declareSynthetic;
	declareSynthetic = hook;
	try {
		return run();
	} finally {
		declareSynthetic = previous;
	}
}

const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** Whether a variant already carries the discriminator, under its declared or its wire name. */
function declaresDiscriminator(program: Program, variant: Type, property: string): boolean {
	if (variant.kind !== "Model") return false;
	return inheritedAndOwnProperties(variant).some(
		(candidate) =>
			candidate.name === property ||
			resolveEncodedName(program, candidate, JSON_MEDIA_TYPE) === property,
	);
}

/**
 * One variant of a `@discriminated` union, as it appears ON THE WIRE.
 *
 * **The union is not a choice between its variant types - it is a choice between wrappings of
 * them**, and this emitter used to ignore the wrapping entirely. `z.discriminatedUnion("kind",
 * [catSchema, dogSchema])` over models that carry no `kind` at all **matches nothing**: every
 * request to a polymorphic endpoint failed, and the differential could not see it because it read a
 * discriminated component as an object.
 *
 * `envelope: "object"` (the default) wraps the variant - `{kind: "cat", value: {...Cat}}` - and
 * openapi3 publishes each wrapper as a component named `union.type.name + capitalize(variantName)`.
 * Mirrored exactly, so the identifiers line up with the component names.
 *
 * `envelope: "none"` injects the discriminator into the variant - `{kind: "cat", ...Cat}` - and is
 * emitted **only when the variant declares that property itself**. Otherwise the document does not
 * publish it and the union is refused; see `undeclared-discriminator`.
 */
function discriminatedVariant(
	program: Program,
	union: Union,
	variantName: string,
	variant: Type,
	options: { envelope: string; discriminatorPropertyName: string; envelopePropertyName: string },
): string {
	const inner = typeToZod(program, variant);
	const tag = `${objectKey(options.discriminatorPropertyName)}: z.literal(${JSON.stringify(variantName)})`;
	// The variant already carries the discriminator, so the document publishes it and there is
	// nothing to add.
	if (options.envelope === "none") return inner;
	const wrapper = `${sealObjectSchemas ? "z.strictObject" : "z.object"}({ ${tag}, ${objectKey(options.envelopePropertyName)}: ${inner} })`;
	const name = `${union.name ?? ""}${capitalise(variantName)}`;
	if (union.name === undefined) return wrapper;
	return declareSynthetic?.(name, () => wrapper) ?? wrapper;
}

function unionToZod(program: Program, union: Union): string {
	/**
	 * A `@discriminated` union becomes `z.discriminatedUnion`, not `z.union`.
	 *
	 * Both accept the same values, but a plain union reports "no variant matched" and lists every
	 * failure, while a discriminated one reads the tag and reports the single rule that was actually
	 * broken. These unions exist to carry cross-field rules that used to hide in a hand-written
	 * predicate - publishing the rule and then reporting it unreadably would only move the problem.
	 */
	const [discriminated] = getDiscriminatedUnion(program, union);
	if (discriminated !== undefined) {
		const options = discriminated.options;
		if (discriminated.defaultVariant !== undefined) {
			// "Anything else" has no discriminator value to switch on. Refused by name rather than
			// silently dropped - no corpus scenario exercises it, so guessing would be untested code.
			return refuse(program, union, "a discriminated union with a default variant");
		}
		/**
		 * **Refused, not compensated for.** With no envelope the discriminator lives inside the
		 * variant, and openapi3 publishes the variant unchanged - so unless the variant declares the
		 * property, the document names a discriminator it never requires, which OpenAPI 3.1 forbids.
		 * Injecting it here would enforce a rule the contract does not state: correct against the wire,
		 * derived from nothing anybody published, and indistinguishable from a bug to every other
		 * reader. A validator may only enforce what the document says.
		 */
		if (options.envelope === "none") {
			const undeclared = [...discriminated.variants.values()].filter(
				(variant) => !declaresDiscriminator(program, variant, options.discriminatorPropertyName),
			);
			if (undeclared.length > 0) {
				reportDiagnostic(program, {
					code: "undeclared-discriminator",
					target: union,
					format: {
						name: union.name ?? "an anonymous union",
						property: options.discriminatorPropertyName,
						variant:
							(undeclared[0] as { name?: string } | undefined)?.name ?? "one of its variants",
					},
				});
				return UNREPRESENTABLE;
			}
		}
		const members = [...discriminated.variants.entries()].map(([name, variant]) =>
			discriminatedVariant(program, union, name, variant, options),
		);
		const property = options.discriminatorPropertyName;
		return `z.discriminatedUnion(${JSON.stringify(property)}, [${members.join(", ")}])`;
	}
	const variants = [...union.variants.values()].map((variant) => variant.type);
	const nullable = variants.some((type) => type.kind === "Intrinsic" && type.name === "null");
	const real = variants.filter((type) => !(type.kind === "Intrinsic" && type.name === "null"));

	if (real.length === 0) {
		reportDiagnostic(program, {
			code: "empty-union",
			target: union,
			format: { why: "every variant is `null`" },
		});
		return UNREPRESENTABLE;
	}

	const suffix = nullable ? ".nullable()" : "";
	if (real.every((type) => type.kind === "String")) {
		const literals = real.map((type) => JSON.stringify((type as { value: string }).value));
		return `z.enum([${literals.join(", ")}])${suffix}`;
	}
	if (real.length === 1) return `${typeToZod(program, real[0] as Type)}${suffix}`;
	return `z.union([${real.map((type) => typeToZod(program, type)).join(", ")}])${suffix}`;
}

/**
 * TypeSpec models arrays and dictionaries as a `Model` carrying an **indexer**.
 *
 * **Keyed on the indexer, not on the model's name.** This used to test `name === "Record"`, which
 * silently lost the indexer of any model *derived* from one - `model ProfileAttributes is
 * Record<string | float64 | boolean>` emitted `z.object({})`, a schema that accepts an object and
 * then strips every key in it. For the profile attributes that is silent data loss on a write, and
 * nothing downstream could have told the difference between "the caller sent nothing" and "we threw
 * it away". A named model is still declared and referenced normally; only its *body* comes from the
 * indexer.
 */
/** `unknown` - the indexer value of a `...Record<unknown>` spread, which is plain permissiveness. */
function isUnknownType(type: Type): boolean {
	return type.kind === "Intrinsic" && type.name === "unknown";
}

/**
 * Every property the model declares, **including the ones it inherits**.
 *
 * **`model.properties` holds only a model's OWN properties, and `baseModel` appeared nowhere in
 * this emitter.** `model Extension extends Element` reaches the document as `allOf: [{$ref: Element}]`
 * beside the derived model's own properties, and the sealing keyword openapi3 uses -
 * `unevaluatedProperties` - is chosen precisely because it sees through that. So the document said
 * `Extension` carries `level` **and** the inherited `extension`, while this emitter produced
 * `z.object({level}).strict()`: the inherited property gone, and the model closed against it. The
 * conformance scenario's own documented request body would have been rejected with a 400 naming a key
 * the contract requires.
 *
 * Invisible for two reasons at once. The spec it was first built against declared no `extends` at
 * all, and the differential
 * skipped every schema carrying an `allOf` - so 28 of 226 components were not divergent, they were
 * never compared.
 *
 * Flattened rather than composed. `z.object(...).extend(...)` would mirror the document's structure
 * more literally and cannot be used here: `.extend()` reads `shape` eagerly, so a base whose property
 * refers back to the derived model - `type/model/inheritance/recursive`, the exact case - would throw
 * during module initialisation. Flattening asks nothing of the base but its properties.
 */
export function inheritedAndOwnProperties(model: Model): ModelProperty[] {
	const chain: Model[] = [];
	for (let link: Model | undefined = model; link !== undefined; link = link.baseModel) {
		chain.unshift(link);
	}
	// Base first, so a derived model REDECLARING a property overrides rather than duplicates it.
	const byName = new Map<string, ModelProperty>();
	for (const link of chain) {
		for (const property of link.properties.values()) byName.set(property.name, property);
	}
	return [...byName.values()];
}

/** The indexer in force, which a model can inherit - `model X extends Record<unknown>`. */
export function effectiveIndexer(model: Model): Model["indexer"] {
	for (let link: Model | undefined = model; link !== undefined; link = link.baseModel) {
		if (link.indexer !== undefined) return link.indexer;
	}
	return undefined;
}

/**
 * The subtypes a `@discriminator` base stands for, in declaration order.
 *
 * Filtered by openapi3's own {@link includeDerivedModel} so a template declaration is not mistaken
 * for a real subtype - the same rule that decides whether a base may be sealed.
 */
export function discriminatedSubtypes(program: Program, model: Model): readonly Model[] {
	if (getDiscriminator(program, model) === undefined) return [];
	return model.derivedModels.filter((derived) => includeDerivedModel(derived));
}

function modelToZod(program: Program, model: Model): string {
	/**
	 * **A `@discriminator` base is a CHOICE between its subtypes, not a shape of its own.**
	 *
	 * `@discriminator("kind") model Bird { kind: string; wingspan: int32 }` with four models extending
	 * it reaches OpenAPI as a component carrying `discriminator: {propertyName, mapping}`, and the
	 * mapping is an instruction: validate the body against whichever subtype the discriminator names.
	 * Emitting the base's own properties instead produced `z.object({kind: z.string(), wingspan})`,
	 * which accepts `{kind: "eagle"}` while ignoring everything `Eagle` actually declares - a
	 * polymorphic endpoint validating none of its polymorphism.
	 *
	 * `z.discriminatedUnion` is the faithful encoding and composes both ways this corpus needs.
	 * Measured on Zod 4.4.3: a union may be an OPTION of another union, which is how
	 * `Fish -> Shark -> SawShark` works; and an option carrying a getter that refers back to the union
	 * being defined does **not** throw, because the discriminator is read without enumerating the rest
	 * of the shape. `Eagle.friends?: Bird[]` is exactly that, and it decides whether polymorphism and
	 * recursion can coexist at all.
	 */
	const subtypes = discriminatedSubtypes(program, model);
	if (subtypes.length > 0) {
		const discriminator = getDiscriminator(program, model);
		const options = subtypes.map((derived) => typeToZod(program, derived));
		return `z.discriminatedUnion(${JSON.stringify(discriminator?.propertyName)}, [${options.join(", ")}])`;
	}
	const indexer = effectiveIndexer(model);
	const indexerKey = indexer?.key.name;
	const declared = inheritedAndOwnProperties(model);
	if (indexerKey === "integer" && indexer !== undefined) {
		return applyConstraints(program, `z.array(${typeToZod(program, indexer.value)})`, model);
	}
	/**
	 * **A string indexer only means "dictionary" when the model declares NO properties.**
	 *
	 * `model X { id: string; ...Record<unknown> }` - the standard TypeSpec way to say "these fields,
	 * plus anything else", and what `@loose` was replaced by - carries both. Returning
	 * `z.record(...)` for it emits a schema that accepts an object and then **strips every declared
	 * field**, so `respond()`'s drift detection degrades to "is it an object" and the pinned fields
	 * silently stop being checked. This function's own history is the other half of the same mistake:
	 * it once keyed on the model's *name*, and lost the indexer of anything derived from `Record`.
	 */
	if (indexerKey === "string" && indexer !== undefined && declared.length === 0) {
		return applyConstraints(
			program,
			`z.record(z.string(), ${typeToZod(program, indexer.value)})`,
			model,
		);
	}
	/**
	 * Permissiveness, read from the INDEXER and from nothing else.
	 *
	 * `...Record<unknown>` is the standard TypeSpec construct and the one `@typespec/openapi3` can
	 * see, so it is the only source. There was a second - `@loose`, a decorator of ours, invisible to
	 * the document - and it is gone: a model that accepted unknown properties while the published
	 * schema said otherwise is a runtime disagreeing with its own contract.
	 *
	 * An indexer over something other than `unknown` is a typed catchall, where `.loose()` would drop
	 * that value type on the floor.
	 */
	const indexerValue = indexerKey === "string" ? indexer?.value : undefined;
	const suffix =
		indexerValue !== undefined && isUnknownType(indexerValue)
			? ".loose()"
			: indexerValue === undefined
				? ""
				: `.catchall(${typeToZod(program, indexerValue)})`;
	/**
	 * A request model REJECTS an unrecognised field rather than stripping it.
	 *
	 * Silently dropping something a caller sent is the same failure this whole surface exists to
	 * remove, one layer out: the request succeeds and does less than it was asked to, with nothing
	 * anywhere reporting it. `appointedOn` went missing for exactly that reason and surfaced as a
	 * confusing downstream 400 instead of a loud one naming the key.
	 */
	const strict = suffix === "" && isSealed(model) ? ".strict()" : "";
	/**
	 * **HTTP metadata is not payload.** A `@header` or `@statusCode` property describes the envelope,
	 * so it never appears in the body - `@typespec/openapi3` strips it from the schema it emits, and a
	 * validator that kept it would demand a field the wire never carries.
	 *
	 * Found the moment a model carried its own content-type: RFC 9457 puts
	 * `@header("content-type") contentType: "application/problem+json"` on the problem model, the
	 * document correctly described a body without it, and this emitter produced
	 * `contentType: z.literal(...)` as a required member. Two artefacts from one source, disagreeing
	 * about the shape of a body - the exact contradiction ADR 0005 exists to make impossible.
	 */
	/**
	 * **A property that refers back into an unfinished declaration is emitted as a GETTER.**
	 *
	 * `model InnerModel { children?: InnerModel[] }` is a plain recursive tree, and openapi3 publishes
	 * it as a self-`$ref`. Emitting `children: z.array(innerModelSchema)` reads the `const` inside its
	 * own initialiser, so the module throws on import; deferring the reference behind a getter is the
	 * idiom Zod documents for exactly this, and it is the only one that keeps `z.infer` inferring the
	 * recursive type rather than collapsing to `any`. `z.lazy(() => innerModelSchema)` runs correctly
	 * but does not typecheck - measured: `TS7022`, "implicitly has type 'any' because it does not have
	 * a type annotation and is referenced directly or indirectly in its own initializer".
	 */
	const members = declared
		.filter((property) => isPayloadProperty(program, property))
		/**
		 * **A `never` property is DROPPED, exactly as the document drops it.** `model N { value:
		 * never; other: string }` is published by `@typespec/openapi3` as `{other}` with
		 * `required: ["other"]` - `value` is absent entirely, because a property that can hold no value
		 * is not part of the payload.
		 *
		 * This emitter kept it and wrote `value: z.never()`, which made the model unsatisfiable: measured,
		 * `{"other":"x"}` - the exact body the document describes - was REJECTED with "expected never,
		 * received undefined". So the validator generated from a document rejected every request that
		 * document calls valid, which is the divergence class this package exists to prevent.
		 *
		 * Dropping it makes the two artefacts agree and leaves nothing to refuse. `never` in a position
		 * that is not a property - a body, a variant - is still refused by `typeToZodBody`, because there
		 * it is not something the document quietly omits.
		 */
		.filter((property) => !isNeverType(property.type))
		.map((property) => {
			const key = propertyKey(program, property);
			const { value, deferred } = captureBackEdges(() => propertyToZod(program, property));
			return {
				deferred,
				text: deferred ? `\tget ${key}() {\n\t\treturn ${value};\n\t},` : `\t${key}: ${value},`,
			};
		});
	const entries = members.map((member) => member.text);
	/**
	 * A model-level `@refine` goes through the same path as every other constraint, so the predicate's
	 * import is recorded exactly once, in one place. Handling it separately here is what dropped the
	 * import the first time - the emitted schema referenced a name it never imported, and only the
	 * compile check in `test/emit.test.ts` noticed.
	 *
	 * `.refine()` returns an effect rather than an object, so `applyConstraints` appending it after
	 * `.loose()` is also the only order that works.
	 */
	/**
	 * **A deferred property forces the CONSTRUCTOR form of the object.**
	 *
	 * Measured on Zod 4.4.3: `.strict()`, `.loose()` and `.catchall()` all read `shape` eagerly, so
	 * each one fires the getter during module initialisation and throws `Cannot access 'X' before
	 * initialization` - the very thing the getter exists to avoid. `z.strictObject` and
	 * `z.looseObject` take the same shape without reading it. The suffix form stays everywhere else,
	 * so a model that does not recurse emits exactly the text it emitted before.
	 *
	 * **A TYPED catchall has no constructor form, and that used to be a refusal.** There is nowhere
	 * safe to put the getter - `.catchall()` reads `shape` eagerly - so the cycle was reported as
	 * `circular-model`. `z.lazy()` is the place to put it: wrapping the whole expression defers the
	 * getter past module initialisation, and by the time the schema is forced every declaration exists.
	 * Measured on 4.4.3: `z.lazy(() => z.object({ get kid() {...} }).catchall(z.number()))` parses a
	 * nested value and still applies the catchall.
	 */
	const lazily = members.some((member) => member.deferred);
	const constructible = suffix === "" || suffix === ".loose()";
	const shape = entries.length === 0 ? "{}" : `{\n${entries.join("\n")}\n}`;
	const body = lazily
		? constructible
			? `${suffix === ".loose()" ? "z.looseObject" : strict === ".strict()" ? "z.strictObject" : "z.object"}(${shape})`
			: `z.lazy(() => z.object(${shape})${suffix}${strict})`
		: `z.object(${shape})${suffix}${strict}`;
	return applyConstraints(program, body, model);
}

/**
 * A name as an object key - quoted when it is not a legal JavaScript identifier.
 *
 * **A TypeSpec property can be named anything**, and the corpus proves it: `parameters/spread`
 * declares `` `x-ms-test-header`: string ``. A parameter walk assumed the property name was always
 * safe - its docblock even argued that using the property name rather than the wire name was what
 * avoided this - and emitted `x-ms-test-header: z.string()`, a file that does not parse.
 *
 * Exported so there is one answer to this question. There were two sites and only one of them knew.
 */
export function objectKey(name: string): string {
	return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/**
 * The name a property carries **on the wire**, which is not always the name the spec gave it.
 *
 * **`@encodedName` is a first-party decorator, and a decorator is a declaration rather than a
 * behaviour.** It attaches metadata to the type graph and does nothing on its own; every emitter has
 * to go and ask. `@typespec/openapi3` asks - `resolveEncodedName` at `schema-emitter.js:214` - so the
 * document publishes the wire name. This emitter did not, so the validator was keyed on the TypeSpec
 * name and a request carrying exactly what the contract required failed twice over: the declared
 * property was missing, and the one actually sent was an unrecognised key a sealed model rejects.
 *
 * The corpus scenario for this is called "Testing that you send the right JSON name on the wire",
 * and it sat in the green column throughout - compiling cleanly while emitting the wrong key.
 *
 * **The domain therefore sees the wire name too**, because `types.ts` resolves it identically. A
 * validator that renamed on the way through would be a transform, which JSON Schema cannot express
 * and no document could state - the same reason `@trimmed` was removed.
 */
function propertyKey(program: Program, property: ModelProperty): string {
	return objectKey(rawPropertyKey(program, property));
}

/** The same wire name, unquoted - for a vocabulary tuple, where the value is data rather than code. */
function rawPropertyKey(program: Program, property: ModelProperty): string {
	return resolveEncodedName(program, property, JSON_MEDIA_TYPE);
}

/**
 * The media type wire names are resolved for.
 *
 * Fixed rather than threaded: everything this emitter produces validates a JSON body, and
 * `@encodedName` is per-media-type. A surface serving XML as well would need this carried from the
 * operation's content type, as openapi3 does - and would need far more than a name to be correct.
 */
const JSON_MEDIA_TYPE = "application/json";

/**
 * The type a value takes **on the wire**, which `@encode` can make different from its declared one.
 *
 * **A first-party decorator, and a decorator is a declaration rather than a behaviour** - every
 * emitter has to go and ask. `@typespec/openapi3` asks, so the document publishes the encoded type;
 * this emitter did not, and validated the DECLARED one. Measured across the corpus, 30 properties
 * where the two disagreed, and each disagreement rejects a body the contract calls valid:
 *
 *   `@encode("csv") string[]`            document `string`   we emitted an array
 *   `@encode(seconds, float) duration`   document `number`   we emitted a string
 *   `@encode(string) int32`              document `string`   we emitted a number
 *   `@encode(unixTimestamp) utcDateTime` document `integer`  we emitted a string
 *
 * Exactly the shape of the `@encodedName` defect, found by exactly the same kind of arm - there, the
 * key a property goes by; here, the type it goes as.
 *
 * **An array encoding on a QUERY parameter is a style, not a type change - and this docblock used
 * to say the opposite.** It claimed the array encodings needed no special case "because a
 * comma-delimited list IS a string on the wire". True of the wire, and the wrong conclusion: the
 * document keeps `type: array` and publishes `style: pipeDelimited` beside it, because the parameter
 * IS a list and the style says how it was flattened. Emitting `z.string()` made the validator
 * disagree with the contract and gave the handler a string where the operation declared `string[]`.
 *
 * The rule is openapi3's own, from `applyEncoding`:
 *
 * ```js
 * if (isQueryParam(program, typespecType) && isParameterStyleEncoding(encodeData.encoding)) {
 *   return targetObject;   // the type is left alone
 * }
 * ```
 *
 * Everywhere else the encoding really does change the type - `@encode(unixTimestamp) utcDateTime` is
 * an integer - so this narrows to exactly the case the reference implementation narrows to. The
 * flattening is undone at the parameter, by {@link COLLECTION_DELIMITERS}.
 */
const PARAMETER_STYLE_ENCODINGS = new Set([
	"ArrayEncoding.pipeDelimited",
	"ArrayEncoding.spaceDelimited",
	"ArrayEncoding.commaDelimited",
	"ArrayEncoding.newlineDelimited",
]);

function encodedTypeOf(program: Program, target: ModelProperty | Scalar): Scalar | undefined {
	const encoded = getEncode(program, target);
	if (encoded === undefined) return undefined;
	if (
		target.kind === "ModelProperty" &&
		isQueryParam(program, target) &&
		PARAMETER_STYLE_ENCODINGS.has(encoded.encoding ?? "")
	) {
		return undefined;
	}
	return encoded.type;
}

export function propertyToZod(program: Program, property: ModelProperty): string {
	/**
	 * **Constraints go INSIDE `.nullable()`, not after it.**
	 *
	 * `z.string().nullable().min(1)` does not compile - `.min` is not on `ZodNullable` - so a property
	 * typed `string | null` with `@minLength(1)` has to emit `z.string().min(1).nullable()`. The
	 * nullability is peeled off here, the constraints applied to what is underneath, and the wrapper
	 * put back. Found by a consumer's own typecheck on a nullable-and-constrained property.
	 *
	 * `.optional()` stays outermost: a constraint after it would apply to the optionality rather than
	 * to the value.
	 */
	const nullable = nullableInnerOf(property.type);
	// `@encode` on the property wins over its declared type - see `encodedTypeOf`. The nullable
	// wrapper is kept: `@encode` changes what the value IS, not whether it may be absent.
	const encoded = encodedTypeOf(program, property);
	const declared = encoded ?? nullable ?? property.type;
	const base =
		nullable === undefined || encoded !== undefined
			? applyConstraints(program, typeToZod(program, declared), property)
			: `${applyConstraints(program, typeToZod(program, declared), property)}.nullable()`;
	/**
	 * A TypeSpec default (`basis: string = "s1159"`) becomes `.default(...)`, which in Zod also makes
	 * the field optional on the way in. Dropping it turned an optional field with a fallback into a
	 * required one - callers omitting it would start getting a 400 for a request that used to work.
	 */
	const defaulted = defaultOf(program, property);
	if (defaulted !== undefined) return `${base}.default(${defaulted})`;
	/**
	 * **Optionality is a function of the position too, not only of the `?` in the spec.**
	 *
	 * TypeSpec's PATCH semantics make a property optional in an update request even where the model
	 * declares it required - an update sends the fields it is changing. The document says so
	 * (`VisibilityModelUpdate` requires nothing) and a validator that still demanded the property
	 * would reject every partial update the contract invites. `metadataInfo.isOptional` is the same
	 * predicate `@typespec/openapi3` uses to decide the `required` list.
	 */
	return property.optional || isOptionalAt(program, property) ? `${base}.optional()` : base;
}

/**
 * A default value as a JS literal, or `undefined` where this emitter cannot render one.
 *
 * **Composite defaults used to be REFUSED, and the refusal was wrong on the emitter's own
 * governing rule.** `#["a", "b"]` and `#{ x: 1 }` were reported as `unsupported-default` with the
 * reason "a populated literal default would need each element rendered, and no schema here has one".
 * That was a statement about this function rather than about what can be represented: `.default()`
 * takes any JS value, and `@typespec/openapi3` publishes these exactly -
 * `default: ["a","b"]`, `default: {"x":1,"label":"hi"}`, and nested arrays too, measured from one
 * compile of a spec carrying all three. So the document could say it, Zod could enforce it, and only
 * this emitter refused - which is the same spec being representable by one emitter and not the other,
 * the one thing a differential between them cannot tolerate.
 *
 * **The refusal also emitted `.default(z.never())`**, because `UNREPRESENTABLE` is a schema
 * expression and this position wants a VALUE. Had the diagnostic ever been downgraded to a warning,
 * that would have compiled and set every such default to a Zod object.
 *
 * A value is pure data - strings, numbers, booleans, null, and arrays and objects of those - so it
 * renders as JSON. Anything else stays a refusal, and `ScalarValue` is the live case: a default like
 * `utcDateTime.fromISO(...)` is a constructor call rather than a literal.
 */
function renderValue(value: Value): string | undefined {
	if (value.valueKind === "StringValue") return JSON.stringify(value.value);
	if (value.valueKind === "NumericValue") return String(value.value.asNumber());
	if (value.valueKind === "BooleanValue") return String(value.value);
	if (value.valueKind === "NullValue") return "null";
	if (value.valueKind === "EnumValue") {
		const member = value.value as { value?: string | number; name: string };
		return JSON.stringify(member.value ?? member.name);
	}
	if (value.valueKind === "ArrayValue") {
		const rendered = value.values.map(renderValue);
		// One unrenderable element makes the whole literal unrenderable - a partial array would be a
		// different default from the one the spec declares, which is worse than refusing.
		return rendered.some((entry) => entry === undefined) ? undefined : `[${rendered.join(", ")}]`;
	}
	if (value.valueKind === "ObjectValue") {
		const entries: string[] = [];
		for (const [name, descriptor] of value.properties) {
			const rendered = renderValue(descriptor.value);
			if (rendered === undefined) return undefined;
			entries.push(`${JSON.stringify(name)}: ${rendered}`);
		}
		return `{${entries.join(", ")}}`;
	}
	return undefined;
}

/** A property's declared default, as a JS literal, or `undefined` when it has none. */
function defaultOf(program: Program, property: ModelProperty): string | undefined {
	const value = property.defaultValue;
	if (value === undefined) return undefined;
	const rendered = renderValue(value);
	if (rendered !== undefined) return rendered;
	reportDiagnostic(program, {
		code: "unsupported-default",
		target: property,
		format: { why: `kind "${value.valueKind}"` },
	});
	/**
	 * **No `.default(...)` at all, rather than a default this emitter invented.** Returning
	 * `UNREPRESENTABLE` here put a schema expression where a value belongs. The property keeps its
	 * declared shape and loses only the fallback, which the diagnostic names.
	 */
	return undefined;
}

/** The non-null half of a two-variant `T | null` union, or `undefined` if it is not one. */
function nullableInnerOf(type: Type): Type | undefined {
	if (type.kind !== "Union") return undefined;
	const variants = [...type.variants.values()].map((variant) => variant.type);
	const real = variants.filter((v) => !(v.kind === "Intrinsic" && v.name === "null"));
	if (real.length !== variants.length - 1 || real.length !== 1) return undefined;
	return real[0];
}

/**
 * Resolves a type to the identifier of an already-declared schema, or `undefined` to inline it.
 *
 * The registry installs this so a named model is emitted once and referenced everywhere else. Kept
 * as module state rather than threaded through every call because `typeToZod` recurses through
 * unions, arrays and properties, and an extra parameter on each would be carried by every case for
 * the benefit of two.
 */
let resolveRef: (type: Type) => string | undefined = () => undefined;

export function withRefResolver<T>(resolver: (type: Type) => string | undefined, run: () => T): T {
	const previous = resolveRef;
	resolveRef = resolver;
	try {
		return run();
	} finally {
		resolveRef = previous;
	}
}

/**
 * How many references the current walk has made **back into a declaration still being rendered**.
 *
 * A recursive model is an ordinary construct - `@typespec/openapi3` emits a self-`$ref` for
 * `model InnerModel { children?: InnerModel[] }` and the document is valid - so the reference has to
 * be emitted, not refused. But a `const` cannot read itself while it is being initialised, so the
 * reference must be made **lazy**, and only the enclosing object knows where to put the getter that
 * does it. The registry counts the back edges; {@link captureBackEdges} is how an object claims them.
 */
let backEdges = 0;

/** Called by the registry when it hands out the identifier of a declaration that is still open. */
export function noteBackEdge(): void {
	backEdges += 1;
}

/**
 * Render `run()`, reporting whether it reached back into a declaration still being rendered.
 *
 * **The count is restored on the way out, and that is the point.** A caller that wraps the
 * reference in a getter has *settled* the back edge - the reference is now lazy and the enclosing
 * object is safe. Letting it propagate would make every ancestor defer as well, and would make the
 * registry report a cycle that has already been dealt with.
 */
export function captureBackEdges<T>(run: () => T): {
	readonly value: T;
	readonly deferred: boolean;
} {
	const before = backEdges;
	const value = run();
	const deferred = backEdges > before;
	backEdges = before;
	return { value, deferred };
}

export function typeToZod(program: Program, type: Type): string {
	const ref = resolveRef(type);
	if (ref !== undefined) return ref;
	return typeToZodBody(program, type);
}

/**
 * The same walk, except that `type` is never resolved to its own identifier.
 *
 * The registry renders a declaration's *body* with this: asking the resolver first would hand back
 * the identifier the declaration is about to bind, emitting `const xSchema = xSchema`. Nested
 * occurrences still go through {@link typeToZod} and do resolve - which is what makes a recursive
 * model reference itself instead of inlining itself forever.
 */
export function typeToZodBody(program: Program, type: Type): string {
	switch (type.kind) {
		case "Scalar":
			return scalarToZod(program, type);
		case "Model":
			return modelToZod(program, type);
		case "Enum":
			return enumToZod(program, type);
		case "Union":
			return unionToZod(program, type);
		case "String":
			return `z.literal(${JSON.stringify(type.value)})`;
		case "Number":
			return `z.literal(${type.value})`;
		case "Boolean":
			return `z.literal(${String(type.value)})`;
		case "EnumMember":
			return `z.literal(${JSON.stringify(type.value ?? type.name)})`;
		/**
		 * **A named union VARIANT is a type you can refer to, and it is not the union.**
		 *
		 * `union DogKind { string, Golden: "golden" }` is TypeSpec's extensible-enum idiom, and
		 * `kind: DogKind.Golden` resolves to the variant rather than to its value. Unreachable until
		 * discriminated subtypes started being declared, at which point the whole
		 * `type/model/inheritance/enum-discriminator` scenario stopped compiling with
		 * "no rule for this kind" - a dormant seam, not a new defect.
		 */
		case "UnionVariant":
			return typeToZod(program, type.type);
		case "Intrinsic":
			if (type.name === "null") return "z.null()";
			if (type.name === "unknown") return "z.unknown()";
			if (type.name === "void" || type.name === "never") {
				return refuse(program, type, `\`${type.name}\` has no runtime representation`);
			}
			return refuse(program, type, `intrinsic "${type.name}"`);
		default:
			return refuse(program, type, "no rule for this kind");
	}
}
