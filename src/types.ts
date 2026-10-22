import {
	getDiscriminatedUnion,
	resolveEncodedName,
	type Enum,
	type Model,
	type ModelProperty,
	type Program,
	type Scalar,
	type Type,
	type Union,
} from "@typespec/compiler";
import { firstReportOf } from "./constraints.js";
import { reportDiagnostic } from "./lib.js";
import { literal } from "./literal.js";
import {
	ANY_JSON_TS,
	atDeclaration,
	atItem,
	atPosition,
	atReading,
	constrainedMembersOf,
	constrainingKeywords,
	discriminatedBaseOf,
	discriminatedSubtypes,
	dispatchedVariantsOf,
	effectiveIndexer,
	emitsDefault,
	encodedIntersects,
	encodedValueOf,
	envelopeNameOf,
	envelopeVisibilityOf,
	exclusiveSiteOf,
	holdsRefusedMember,
	implicitlyOptional,
	inParameterPosition,
	isExclusiveHere,
	isOptionalAt,
	isRawBytes,
	isTypelessMember,
	multipartBinaryContext,
	keptMembersOf,
	type Keyworded,
	LIST_TEMPLATE_REMEDY,
	listTemplateInstanceWhy,
	type Merged,
	type MergedObject,
	membersToWrite,
	nullableInnerOf,
	objectKey,
	objectOfModel,
	OWN_POSITION,
	type PropertyPosition,
	refusalTarget,
	replacesFormOf,
	scalarEncodingOf,
	sealedBaseExtensionOf,
	TUPLE_PARAMETER,
	undeclaredVariantOf,
	unsatisfiableSubtype,
	withDeclarationSite,
	withExclusiveSite,
	withVisibility,
} from "./zod.js";

/**
 * TypeSpec type -> plain TypeScript type text.
 *
 * **Why a second walker rather than `z.infer` of the emitted Zod.** The contract types are meant to
 * be framework-free: a codebase passes them between layers that have no business importing a
 * validation library, and layering rules commonly forbid exactly that. A type inferred from a schema
 * drags the schema - and `zod` - everywhere it goes, so the shared type has to be emitted as ordinary
 * TypeScript. That is the whole point: one declaration both sides are checked against, with neither
 * importing the other.
 *
 * **It must agree with `zod.ts` exactly**, because the emitted assertion compares them. Every rule
 * here has a counterpart there: `utcDateTime` is a string on both sides, `?` is `?: T` because
 * `.exactOptional()` refuses an explicit `undefined` and `?: T | undefined` only where `.default()`
 * accepts one, and a property the document leaves out of `required` is optional here whether its
 * absence is spelled `?` or covered by a default.
 *
 * **The assertion pairs this walk against `z.input`, the type the validator ACCEPTS**, and not
 * against `z.infer`, which is what it produces. These types are the floor a producer supplies, and
 * for a request the producer is a caller who has not run the validator.
 */

/** The scalars this walk accepts, and the TypeScript they become. Mirrors `SCALARS` in `zod.ts`. */
const SCALARS: Readonly<Record<string, string>> = {
	string: "string",
	boolean: "boolean",
	bytes: "string",
	int8: "number",
	int16: "number",
	int32: "number",
	int64: "number",
	safeint: "number",
	uint8: "number",
	uint16: "number",
	uint32: "number",
	uint64: "number",
	integer: "number",
	float: "number",
	float32: "number",
	float64: "number",
	decimal: "number",
	decimal128: "number",
	numeric: "number",
	/** Dates cross the wire as strings - `zod.ts` emits `z.string()` for all of these. */
	utcDateTime: "string",
	offsetDateTime: "string",
	plainDate: "string",
	plainTime: "string",
	duration: "string",
	url: "string",
};

/**
 * What a walk returns after reporting a refusal - see `UNREPRESENTABLE` in `zod.ts`.
 *
 * `never` is the honest placeholder in TypeScript: nothing is assignable to it, so a contract type
 * built on one cannot be used by accident, and the error diagnostic has already failed the compile.
 */
const UNREPRESENTABLE = "never";

/**
 * Refuse `type`, pointing at somewhere the reader can go, and carry on so the rest is reported too.
 *
 * An intrinsic has no source node, so it is located by the declaration being walked instead - see
 * `withDeclarationSite` in `zod.ts`, whose scope this walk shares.
 */
function refuse(program: Program, type: Type, why: string, remedy = ""): string {
	// Once per declaration, whichever walk reaches it first: both walk every type.
	const target = refusalTarget(type);
	if (firstReportOf(program, "unsupported-type", target, `${type.kind} ${why}`)) {
		reportDiagnostic(program, {
			code: "unsupported-type",
			target,
			format: { artefact: "a TypeScript type", kind: type.kind, why, remedy },
		});
	}
	return UNREPRESENTABLE;
}

function scalarToTs(program: Program, scalar: Scalar): string {
	// A scalar declaration can carry the encoding itself, or inherit it - see `scalarEncodingOf`.
	const encoded = scalarEncodingOf(program, scalar)?.encoded;
	// A scalar that is not standard states no type; the schema walk reports it.
	if (encoded !== undefined && !program.checker.isStdType(encoded)) return UNREPRESENTABLE;
	if (encoded !== undefined) return scalarToTs(program, encoded);
	let current: Scalar | undefined = scalar;
	// Walk `extends` so `scalar isbn extends string` resolves to the primitive underneath.
	while (current !== undefined) {
		const mapped = program.checker.isStdType(current) ? SCALARS[current.name] : undefined;
		if (mapped !== undefined) return mapped;
		current = current.baseScalar;
	}
	/**
	 * **`unknown`, matching `z.unknown()` on the other side and `{}` in the document.**
	 *
	 * **Fixing only the Zod walk left the two artefacts describing different shapes.** `scalarToZod`
	 * was changed to emit `z.unknown()` for a scalar with no known base, because openapi3 publishes the
	 * empty schema and that asserts nothing. This walk still refused, so a spec compiled with
	 * `contracts-output-dir` set got `value: z.unknown()` in `schemas.gen.ts` and `value: never` in
	 * `requests.gen.ts` - plus the refusal that was supposed to be gone.
	 *
	 * That is the disagreement `wire-contract.gen.ts` exists to catch, reintroduced by the fix for the
	 * defect beside it. A compile that leaves `contracts-output-dir` unset never runs this walk, so
	 * only a check with it set sees the disagreement - the same shape as the `never` property, where
	 * the diagnostic came from the walk nobody was looking at.
	 */
	return "unknown";
}

/** Declares a shape no type stands for under a name - see `withTsSyntheticDeclarations`. */
let declareSynthetic: ((name: string, build: () => string, site: Type) => string) | undefined;

/**
 * **A type the document publishes that no TypeSpec type stands for** - an envelope, `PetCat` -
 * declared under its name by the registry, as the schema registry declares its validator.
 */
export function withTsSyntheticDeclarations<T>(
	hook: (name: string, build: () => string, site: Type) => string,
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

function enumToTs(target: Enum): string {
	const values = [...target.members.values()].map((member) => member.value ?? member.name);
	return values.map((value) => literal(value)).join(" | ");
}

function unionToTs(program: Program, union: Union): string {
	/**
	 * A `@discriminated` union is a choice between WRAPPINGS of its variants - see
	 * `discriminatedVariant` in `zod.ts` for the two wire shapes and why `envelope: "none"` diverges
	 * from the document. Emitted here too, or the contract type says `Cat | Dog` while the validator
	 * requires `{kind, value}` and the assertion pairing them fails.
	 */
	const [discriminated] = getDiscriminatedUnion(program, union);
	if (discriminated !== undefined && discriminated.defaultVariant === undefined) {
		const { envelope, discriminatorPropertyName, envelopePropertyName } = discriminated.options;
		// Refused by the Zod walk as `undeclared-discriminator`, and `never` on both sides.
		if (
			envelope === "none" &&
			[...discriminated.variants.values()].some((variant) => {
				const why = undeclaredVariantOf(program, variant, discriminatorPropertyName);
				return why === "missing" || why === "open";
			})
		) {
			return UNREPRESENTABLE;
		}
		// A variant no value can be is dropped, as `unionToZod` drops it.
		const variants = dispatchedVariantsOf(program, union);
		if (variants.length === 0) return UNREPRESENTABLE;
		const arms = variants.map(([name, variant]) => {
			// Optional where the envelope is published at a PATCH - see `envelopeVisibilityOf`.
			const optional = implicitlyOptional(envelopeVisibilityOf(program, union, variant)) ? "?" : "";
			const tag = `${objectKey(discriminatorPropertyName)}${optional}: ${literal(name)};`;
			const inner = typeToTs(program, variant);
			// No injection: with no envelope the variant declares the discriminator itself, or the union
			// is refused in `zod.ts`. Nothing is added that the document does not publish.
			if (envelope === "none") return inner;
			const wrapper = `{ ${tag} ${objectKey(envelopePropertyName)}${optional}: ${inner}; }`;
			// Declared under the component openapi3 publishes it as, as the validator is.
			const declared = envelopeNameOf(program, union, name, variant);
			return declared === undefined
				? wrapper
				: (declareSynthetic?.(declared, () => wrapper, union) ?? wrapper);
		});
		return arms.join(" | ");
	}
	// Refused with the validator, which says why - see `holdsRefusedMember`.
	if (holdsRefusedMember(program, union, isExclusiveHere(program, union))) return UNREPRESENTABLE;
	const variants = [...union.variants.values()].map((variant) => variant.type);
	if (variants.length === 0) {
		reportDiagnostic(program, {
			code: "empty-union",
			target: union,
			format: { why: "it is empty" },
		});
		return UNREPRESENTABLE;
	}
	// A raw `bytes` member of a multipart part's union is any value - see `withMultipartBinary`.
	return variants
		.map((type) =>
			multipartBinaryContext() && isRawBytes(program, type) ? "unknown" : typeToTs(program, type),
		)
		.join(" | ");
}

function modelToTs(program: Program, model: Model): string {
	/**
	 * **A `@discriminator` base is a CHOICE between its subtypes, not a shape of its own - and this
	 * walk did not know that.** `modelToZod` has had the rule since polymorphism was first supported;
	 * here the base was walked as an ordinary model, so `@discriminator("kind") model Shape` produced
	 * `interface Shape { kind: string; label: string }`.
	 *
	 * Three things were wrong with that at once. The type could not be discriminated, so no consumer
	 * could narrow it; `kind: string` admitted every string the validator rejects; and the subtypes got
	 * no declaration at all, because nothing reached them.
	 *
	 * **It survived because the two walks are only ever compared where a spec declares polymorphism
	 * AND something compiles the emitted assertions.** `wire-contract.gen.ts` exists precisely to catch
	 * the emitter disagreeing with itself - one TypeSpec, walked twice - and this is the second defect
	 * of that class it has found. The first was a vocabulary inlined by one walk and referenced by the
	 * other.
	 *
	 * **The base itself is the last arm**, as `modelToZod` writes it: a value that is no valid instance
	 * of the subtype its discriminator names is the base's own object, which is what the document
	 * validates it as. `z.input` of the union and this type are therefore identical.
	 */
	const base = discriminatedBaseOf(program, model);
	if (base !== undefined) {
		const arms = discriminatedSubtypes(program, model).map((derived) => typeToTs(program, derived));
		arms.push(modelObjectToTs(program, model));
		return arms.join(" | ");
	}
	return modelObjectToTs(program, model);
}

/**
 * A model as the object of its own properties, inherited ones included - for a discriminated base,
 * the base, with the `string` discriminator openapi3 adds where the base declares none.
 */
function modelObjectToTs(program: Program, model: Model): string {
	// Refused by the Zod walk - `sealed-base-extended`, `invalid-subtype-discriminator` - and `never`
	// on both sides.
	const extension = sealedBaseExtensionOf(program, model);
	if (extension?.required === true || unsatisfiableSubtype(program, model)) return UNREPRESENTABLE;
	const indexer = effectiveIndexer(model);
	if (indexer?.key.name === "integer") {
		const element = atItem(program, model, () => typeToTs(program, indexer.value));
		// Parenthesised so `A | B` as an element does not become `A | B[]`.
		return /[|&\s]/.test(element) ? `(${element})[]` : `${element}[]`;
	}
	// Inherited properties included, each judged where it is published, and the discriminator openapi3
	// adds - the object `modelObjectToZod` writes, from the one `objectOfModel` both walks read.
	return mergedToTs(program, objectOfModel(program, model));
}

/**
 * An object as TypeScript: the same members `objectToZod` writes, a dictionary as a `Record`.
 *
 * **A string indexer only means "dictionary" when the model declares NO properties.** The same trap
 * `modelToZod` had, and it bites harder here: a permissive response model is written
 * `{ ...pinned fields; ...Record<unknown> }`, so reading the indexer first would type every such
 * model as a bare `Record<string, unknown>` - a type that satisfies any assertion about what the
 * response contains, which is precisely the check this file exists to feed.
 *
 * **Metadata, invisible and `never` properties are left out here, as on the Zod side, and the two
 * must agree** - both read one member list. Two walks over one TypeSpec have to agree about which
 * properties exist, or `wire-contract.gen.ts` pairs a validator against a type describing a
 * different shape.
 */
/** Whether a merged dictionary is written as an object of its own - see `mergedToTs`. */
let spellingDictionaries = false;

function objectToTs(program: Program, object: MergedObject): string {
	const { rest } = object;
	/**
	 * **A dictionary is an object with an indexer and no member where it is used** - the wire
	 * assertion's own reading of `z.input`. A model whose only properties are a `@header` or a
	 * create-only key, returned by a GET, is validated as `z.object({}).catchall(...)` there, and was
	 * typed `{}` for declaring properties, which the assertion refused.
	 */
	const dictionary = object.dictionary || object.members.length === 0;
	// The library's `Record`, whatever the spec names its own - see `LIBRARY_NAMES_WRITTEN_BARE` -
	// or an object of its own, where a union writes it twice - see `mergedToTs`.
	const dictionaryOf = (value: string): string =>
		spellingDictionaries ? `{ [key: string]: ${value} }` : `globalThis.Record<string, ${value}>`;
	if (dictionary && rest === "loose") return dictionaryOf("unknown");
	if (dictionary && typeof rest !== "string") {
		const value = mergedToTs(program, rest);
		/**
		 * A dictionary of nothing admits only `{}`, the empty object an empty model is written as;
		 * `Record<string, never>` is how Zod infers both, and the wire contract reads it as `{}`.
		 */
		return value === UNREPRESENTABLE ? "{}" : dictionaryOf(value);
	}
	const entries = object.members.map(({ key, property, position }) =>
		property === undefined
			? `\t${objectKey(key)}${position.required ? "" : "?"}: ${mergedToTs(program, position.value ?? { kind: "never" })};`
			: `\t${withDeclarationSite(property, () =>
					atPosition(position, () =>
						atDeclaration(program, property, () =>
							propertyToTs(program, property, undefined, position),
						),
					),
				)}`,
	);
	/**
	 * **The indexer is deliberately NOT intersected in.**
	 *
	 * `{ ...pinned } & Record<string, unknown>` looks like the honest rendering of a permissive model,
	 * and it makes the type unsatisfiable: a plain interface has no index signature, so no domain
	 * result can be assignable to it and the assertion this type feeds fails for **every** operation.
	 * A gate that fails for everything is as useless as one that passes for everything.
	 *
	 * Permissiveness is a statement about the VALIDATOR - what it lets through - not about what a
	 * producer must contain. The contract type is the floor: these fields, at least.
	 */
	/**
	 * **`0.16.0` added the catchall here and `0.17.0` reverted it. Do not add it again.**
	 *
	 * The argument for it was that the document says `additionalProperties` and the validator says
	 * `.loose()`, so the type should say it too. Both of those state what is TOLERATED ON ARRIVAL. On
	 * the type it reads as an obligation on whoever PRODUCES the value, and TypeScript gives an
	 * interface no implicit index signature (microsoft/TypeScript#15300) - only a type alias gets one
	 * - so whether a producer could satisfy the published shape came to depend on which keyword its
	 * own domain type happened to use, in files this emitter does not own.
	 *
	 * **Where an open component nests another open component**, the obligation costs a structural
	 * deep copy of the response tree per response. One spread satisfies one level and does not reach
	 * the next, which is the whole shape of the failure - see `test/contractshape/`.
	 *
	 * What arrives is still described honestly, on the surface derived from the validator:
	 * `schemas.gen.ts` exports `z.infer<typeof x>`, which carries the index signature because a
	 * `.loose()` parse really does. Two surfaces, two directions, neither lying.
	 */
	return entries.length === 0 ? "{}" : `{\n${entries.join("\n")}\n}`;
}

/**
 * A merged value as TypeScript - `z.input` of what `mergedToZod` writes for it, node for node.
 */
export function mergedToTs(program: Program, value: Merged): string {
	switch (value.kind) {
		case "never":
		case "refused":
			return UNREPRESENTABLE;
		case "type": {
			const typed = (): string => typeWithKeywordsToTs(program, value.type, value.keywords);
			return value.at === undefined ? typed() : withVisibility(value.at, typed);
		}
		case "whole":
			return propertyValueToTs(program, value.property);
		case "nullable":
			return `${mergedToTs(program, value.inner)} | null`;
		case "union": {
			// The members the validator writes - see `membersToWrite`.
			const members = membersToWrite(program, value);
			const texts = members.map((member) => mergedToTs(program, member));
			/**
			 * **A dictionary written twice is written as two objects.** TypeScript reads
			 * `Record<string, unknown>` twice as the one type it names, where the validator writes two
			 * objects - `z.xor([z.looseObject({}), z.looseObject({})])`, a `@oneOf` of two merged
			 * members alike - whose two `z.input` types are two, and the wire assertion told them apart
			 * (`TS2344`). Spelled as an object, each is a type of its own, as each validator's is.
			 */
			return members
				.map((member, index) => {
					const text = texts[index] as string;
					if (texts.indexOf(text) === texts.lastIndexOf(text)) return text;
					const previous = spellingDictionaries;
					spellingDictionaries = true;
					try {
						return mergedToTs(program, member);
					} finally {
						spellingDictionaries = previous;
					}
				})
				.join(" | ");
		}
		case "all":
			return value.parts.map((part) => `(${mergedToTs(program, part)})`).join(" & ");
		case "array": {
			const list = value.list;
			const element =
				list === undefined
					? mergedToTs(program, value.element)
					: atItem(program, list, () => mergedToTs(program, value.element));
			return /[|&\s]/.test(element) ? `(${element})[]` : `${element}[]`;
		}
		case "object":
			return objectToTs(program, value);
	}
}

/** A type with keywords on it: the members they leave - see `keptMembersOf`. */
function typeWithKeywordsToTs(
	program: Program,
	type: Type,
	keywords: readonly Keyworded[],
): string {
	const sources = constrainingKeywords(program, keywords);
	if (sources.length === 0) return typeToTs(program, type);
	const member = (each: Type): string =>
		isTypelessMember(program, each) ? `(${ANY_JSON_TS})` : typeToTs(program, each);
	const members = keptMembersOf(program, type, sources);
	if (members === undefined) return member(type);
	return members.length === 0 ? UNREPRESENTABLE : members.map(member).join(" | ");
}

/**
 * A property line, including its optionality marker.
 *
 * `wireName` overrides the key for an HTTP PARAMETER, whose wire name comes from `@header("x-thing")`
 * or `@query("$select")` rather than from any JSON encoding. `resolveEncodedName` cannot see those,
 * so a header renamed on the wire was keyed here by its TypeScript property name while the emitted
 * validator keyed it by the wire name. Handlers checked against the generated input types then
 * failed to typecheck against a server that was correct: `z.object({ "x-thing": ... })`
 * on one side and `{ thing: string }` on the other.
 */
/**
 * The TypeScript type of a property's VALUE, without its key or its optionality.
 *
 * Shared with the annotation the registry writes on a deferred (getter) property, so the type that
 * annotation claims is by construction the type this walk renders for the same property.
 */
export function propertyTypeToTs(
	program: Program,
	property: ModelProperty,
	position: PropertyPosition = OWN_POSITION,
): string {
	// What the declarations above it leave of the value - see `PropertyPosition`.
	if (position.never || position.refused !== undefined) return UNREPRESENTABLE;
	if (position.nullOnly) return "null";
	if (position.value !== undefined) return mergedToTs(program, position.value);
	return atReading(program, property, () => propertyValueToTs(program, property, position));
}

function propertyValueToTs(
	program: Program,
	property: ModelProperty,
	position: PropertyPosition = OWN_POSITION,
): string {
	/**
	 * **`@encode` changes the wire TYPE, and `encodedTypeOf` is the one rule for when it does.** This
	 * read `getEncode(...).type` directly, so it missed the exception the Zod walk makes: an array
	 * encoding on a QUERY parameter is a style of flattening, not a type, and the validator splits it
	 * back into the declared list. So `WireInputs` said `colors: string` for a pipe-delimited query
	 * whose handler is given `string[]` - two walks of one property, one of them knowing a rule.
	 */
	/**
	 * **And `encodedValueOf` is the rule for what the value then is**, read exactly as the Zod walk
	 * reads it, so `z.input` and this type agree: the declared type where the document keeps it beside
	 * the encoded scalar, the scalar where it does not, both where each constrains the other, and
	 * `never` where no value is both. A nullable property stays nullable.
	 */
	const encoding = encodedValueOf(program, property);
	switch (encoding.kind) {
		case "declared": {
			// A constrained union keeps the members its own keywords allow - see `constrainedMembersOf`.
			const members = constrainedMembersOf(program, property, position);
			const inner = nullableInnerOf(property.type);
			// A `null` a declaration above refuses is left out, as the validator leaves it out.
			if (members === undefined) {
				const declared = position.nonNull && inner !== undefined ? inner : property.type;
				// A property's `@oneOf` makes its inline union exclusive, as the Zod walk reads it.
				return withExclusiveSite(exclusiveSiteOf(program, property, declared), () =>
					typeToTs(program, declared),
				);
			}
			const text =
				members.length === 0
					? UNREPRESENTABLE
					: members
							.map((member) =>
								isTypelessMember(program, member) ? `(${ANY_JSON_TS})` : typeToTs(program, member),
							)
							.join(" | ");
			return inner === undefined || position.nonNull ? text : orNull(text, true);
		}
		case "unsatisfiable":
			return UNREPRESENTABLE;
		case "replaced":
			return orNull(typeToTs(program, encoding.scalar), encoding.nullable && !position.nonNull);
		case "both": {
			const member = (each: Type): string =>
				replacesFormOf(program, encoding, each)
					? typeToTs(program, encoding.scalar)
					: typeToTs(program, each);
			const kept = Array.isArray(encoding.kept)
				? encoding.kept.map(member).join(" | ")
				: member(encoding.kept as Type);
			const value = encodedIntersects(program, property, encoding)
				? `${typeToTs(program, encoding.scalar)} & (${kept})`
				: kept;
			return orNull(value, encoding.nullable);
		}
	}
}

function orNull(text: string, nullable: boolean): string {
	return nullable ? `${text} | null` : text;
}

export function propertyToTs(
	program: Program,
	property: ModelProperty,
	wireName?: string,
	position: PropertyPosition = OWN_POSITION,
): string {
	// The WIRE name, resolved exactly as `zod.ts` resolves it - `wire-contract.gen.ts` asserts the
	// emitted Zod infers this type, so the two must name every property identically or it fails.
	const key = objectKey(wireName ?? resolveEncodedName(program, property, "application/json"));
	const value = propertyTypeToTs(program, property, position);
	/**
	 * **A defaulted property used to be REQUIRED here, and that was the OUTPUT type's answer to a
	 * question this file does not ask.**
	 *
	 * The reasoning was: `zod.ts` emits `.default(v)`, the assertion compares against `z.infer` which
	 * is the output type, and by then the default has fired. Every step of that is true and the
	 * conclusion served the wrong reader. **These types are the floor a PRODUCER supplies**, and for
	 * a request the producer is the CALLER - who has not run the validator, and for whom the document
	 * is the only contract. The document leaves an optional defaulted property out of `required`, so
	 * a caller may omit it, and this file said they could not.
	 *
	 * A helper relaxing such properties by hand reaches only the top level: a default one level down
	 * stays required, and no caller can build the value at all. Emitting the optionality per property
	 * fixes every depth at once, because there is no depth to reach.
	 *
	 * **The two directions of the emitted set differ here on purpose**, exactly as they do on
	 * openness: `schemas.gen.ts` exports `z.infer<...>`, the narrow view of what ARRIVES, in which a
	 * default has fired and the property is present. `wire-contract.gen.ts` pairs this walk against
	 * `z.input` for the same reason.
	 *
	 * A defaulted property that reaches here is one the document publishes as optional, because
	 * `propertyToZod` reports `default-on-required-property` for the other spelling and emits no
	 * `.default(...)` for it - so the two walks agree without either one restating the rule.
	 */
	/**
	 * **`?: T`, and `?: T | undefined` only where the validator emits `.default(...)`. The contract
	 * type is the validator's INPUT, `z.input`, at every property.**
	 *
	 * `.exactOptional()` refuses `{ note: undefined }` and `.default(v)` accepts it, so those are the
	 * two answers; {@link emitsDefault} says which one this property got. `wire-contract.gen.ts`
	 * compares the two walks with nothing widened, so a disagreement here does not compile.
	 *
	 * **This was `?: T | undefined` for every optional, kept deliberately on three reasons that were
	 * each measured false** once `0.24.0` moved the validator to `.exactOptional()`:
	 *
	 * - the echo handler `(ctx, input) => ok(input)` broke without it, because what a handler
	 *   received carried `| undefined`. What it receives is `z.infer` of `.exactOptional()` now,
	 *   `?: T`, and the echo compiles;
	 * - `{ note: undefined }` serialises identically to omitting the key. A server checks a body
	 *   before it serialises it: a value typed by `WireOutputs` reached `servedBody` and answered
	 *   500 for a body whose bytes were valid, and across a service binding it is never serialised;
	 * - refusing it costs a producer a conditional spread. That spread infers `{ note?: string }` on
	 *   TypeScript 5.9 and 7.0 and assigns to the exact type, and it is what a producer under
	 *   `exactOptionalPropertyTypes` writes for the handler's own return type anyway.
	 *
	 * openapi-typescript, `hc` and `z.infer` all spell an optional `?: T`, so `?: T | undefined`
	 * disagreed with every surface the contract types are compared against.
	 */
	/**
	 * **Optional AT THIS POSITION, not merely optional in the declaration.** A PATCH body's properties
	 * are optional whether or not the spec marked them so, which is `metadataInfo.isOptional` and is
	 * what `propertyToZod` has always consulted. This walk read `property.optional` alone, so an
	 * update contract demanded every field while the validator beside it accepted any subset.
	 */
	if (position.required || !(property.optional || isOptionalAt(program, property))) {
		return `${key}: ${value};`;
	}
	return emitsDefault(program, property, position)
		? `${key}?: ${value} | undefined;`
		: `${key}?: ${value};`;
}

/** Installed by the registry so a named model is declared once and referenced everywhere else. */
let resolveRef: (type: Type) => string | undefined = () => undefined;

export function withTsRefResolver<T>(
	resolver: (type: Type) => string | undefined,
	run: () => T,
): T {
	const previous = resolveRef;
	resolveRef = resolver;
	try {
		return run();
	} finally {
		resolveRef = previous;
	}
}

export function typeToTs(program: Program, type: Type): string {
	const ref = resolveRef(type);
	if (ref !== undefined) return ref;
	return typeToTsBody(program, type);
}

/**
 * The same walk, except that `type` is never resolved to its own name - see `SchemaRegistry.#inline`
 * for why the "not itself" rule has to sit at the top of the walk rather than inside the resolver.
 */
export function typeToTsBody(program: Program, type: Type): string {
	switch (type.kind) {
		case "Scalar":
			return scalarToTs(program, type);
		case "Model": {
			// Refused as the schema walk refuses it - see `listTemplateInstanceWhy`.
			const why = listTemplateInstanceWhy(program, type);
			if (why !== undefined) return refuse(program, type, why, LIST_TEMPLATE_REMEDY);
			return modelToTs(program, type);
		}
		case "Enum":
			return enumToTs(type);
		case "Union":
			return unionToTs(program, type);
		case "String":
			return literal(type.value);
		case "Number":
			return String(type.value);
		case "Boolean":
			return String(type.value);
		case "EnumMember":
			return literal(type.value ?? type.name);
		// A named union variant is a referable type - `DogKind.Golden`. See the note in `zod.ts`.
		case "UnionVariant":
			return typeToTs(program, type.type);
		case "Intrinsic":
			if (type.name === "null") return "null";
			if (type.name === "unknown") return "unknown";
			if (type.name === "void" || type.name === "never") {
				return refuse(
					program,
					type,
					`\`${type.name}\` has no runtime representation`,
					"Give the position a type a value can inhabit. A `never` property or parameter is dropped to match the document, and `Record<never>` seals the model, so none of those reaches here.",
				);
			}
			return refuse(
				program,
				type,
				`intrinsic "${type.name}"`,
				"This emitter has no rule for that intrinsic. Replace it with a declared scalar or model.",
			);
		// `z.input` of the schema walk's `z.tuple([...exactOptional], z.unknown())`.
		case "Tuple": {
			if (inParameterPosition()) {
				return refuse(program, type, TUPLE_PARAMETER.why, TUPLE_PARAMETER.remedy);
			}
			const positions = type.values.map((value) => `(${typeToTs(program, value)})?`);
			return `[${[...positions, "...unknown[]"].join(", ")}]`;
		}
		default:
			return refuse(
				program,
				type,
				"no rule for this kind",
				"Replace it with a model, scalar, enum or union, which are the kinds this emitter walks.",
			);
	}
}
