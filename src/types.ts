import {
	getDiscriminatedUnion,
	getEncode,
	isNeverType,
	resolveEncodedName,
	type Enum,
	type Model,
	type ModelProperty,
	type Program,
	type Scalar,
	type Type,
	type Union,
} from "@typespec/compiler";
import { reportDiagnostic } from "./lib.js";
import {
	discriminatedSubtypes,
	effectiveIndexer,
	inheritedAndOwnProperties,
	objectKey,
} from "./zod.js";

/**
 * TypeSpec type → plain TypeScript type text.
 *
 * **Why a second walker rather than `z.infer` of the emitted Zod.** The contract types are meant to
 * be framework-free: a codebase passes them between layers that have no business importing a
 * validation library, and layering rules commonly forbid exactly that. A type inferred from a schema
 * drags the schema — and `zod` — everywhere it goes, so the shared type has to be emitted as ordinary
 * TypeScript. That is the whole point: one declaration both sides are checked against, with neither
 * importing the other.
 *
 * **It must agree with `zod.ts` exactly**, because the emitted assertion compares them. Every rule
 * here has a counterpart there: `utcDateTime` is a string on both sides, `?` becomes
 * `?: T | undefined` because `exactOptionalPropertyTypes` is on, and a defaulted property is
 * **required** here because `z.infer` reports the *output* type and a default has always fired by
 * then.
 */

/** Scalars we accept, and the TypeScript they become. Mirrors `SCALARS` in `zod.ts`. */
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
	/** Dates cross the wire as strings — `zod.ts` emits `z.string()` for all of these. */
	utcDateTime: "string",
	offsetDateTime: "string",
	plainDate: "string",
	plainTime: "string",
	duration: "string",
	url: "string",
};

/**
 * What a walk returns after reporting a refusal — see `UNREPRESENTABLE` in `zod.ts`.
 *
 * `never` is the honest placeholder in TypeScript: nothing is assignable to it, so a contract type
 * built on one cannot be used by accident, and the error diagnostic has already failed the compile.
 */
const UNREPRESENTABLE = "never";

/** Refuse `type`, pointing at its declaration, and carry on so the rest is reported too. */
function refuse(program: Program, type: Type, why: string): string {
	reportDiagnostic(program, {
		code: "unsupported-type",
		target: type,
		format: { artefact: "a TypeScript type", kind: type.kind, why },
	});
	return UNREPRESENTABLE;
}

function scalarToTs(program: Program, scalar: Scalar): string {
	// A scalar declaration can carry the encoding itself — see `scalarToZod`.
	const encoded = getEncode(program, scalar)?.type;
	if (encoded !== undefined && encoded !== scalar) return scalarToTs(program, encoded);
	let current: Scalar | undefined = scalar;
	// Walk `extends` so `scalar TrimmedString extends string` resolves to the primitive underneath.
	while (current !== undefined) {
		const mapped = SCALARS[current.name];
		if (mapped !== undefined) return mapped;
		current = current.baseScalar;
	}
	/**
	 * **`unknown`, matching `z.unknown()` on the other side and `{}` in the document.**
	 *
	 * ⚠️ **Fixing only the Zod walk left the two artefacts describing different shapes.** `scalarToZod`
	 * was changed to emit `z.unknown()` for a scalar with no known base, because openapi3 publishes the
	 * empty schema and that asserts nothing. This walk still refused, so a consumer with
	 * `contracts-output-dir` set got `value: z.unknown()` in `schemas.gen.ts` and `value: never` in
	 * `requests.gen.ts` — plus the refusal that was supposed to be gone.
	 *
	 * That is the disagreement `wire-contract.gen.ts` exists to catch, reintroduced by the fix for the
	 * defect beside it. It went unseen for one commit because the verification compile left
	 * `contracts-output-dir` unset, so this walk never ran — the same shape as the `never` property,
	 * where the diagnostic came from the walk nobody was looking at.
	 */
	return "unknown";
}

function enumToTs(target: Enum): string {
	const values = [...target.members.values()].map((member) => member.value ?? member.name);
	return values.map((value) => JSON.stringify(value)).join(" | ");
}

function unionToTs(program: Program, union: Union): string {
	/**
	 * A `@discriminated` union is a choice between WRAPPINGS of its variants — see
	 * `discriminatedVariant` in `zod.ts` for the two wire shapes and why `envelope: "none"` diverges
	 * from the document. Emitted here too, or the contract type says `Cat | Dog` while the validator
	 * requires `{kind, value}` and the assertion pairing them fails.
	 */
	const [discriminated] = getDiscriminatedUnion(program, union);
	if (discriminated !== undefined && discriminated.defaultVariant === undefined) {
		const { envelope, discriminatorPropertyName, envelopePropertyName } = discriminated.options;
		const arms = [...discriminated.variants.entries()].map(([name, variant]) => {
			const tag = `${objectKey(discriminatorPropertyName)}: ${JSON.stringify(name)};`;
			const inner = typeToTs(program, variant);
			// No injection: with no envelope the variant declares the discriminator itself, or the union
			// is refused in `zod.ts`. Nothing is added that the document does not publish.
			return envelope === "none"
				? inner
				: `{ ${tag} ${objectKey(envelopePropertyName)}: ${inner}; }`;
		});
		return arms.join(" | ");
	}
	const variants = [...union.variants.values()].map((variant) => variant.type);
	if (variants.length === 0) {
		reportDiagnostic(program, {
			code: "empty-union",
			target: union,
			format: { why: "it is empty" },
		});
		return UNREPRESENTABLE;
	}
	return variants.map((type) => typeToTs(program, type)).join(" | ");
}

function modelToTs(program: Program, model: Model): string {
	/**
	 * ⚠️ **A `@discriminator` base is a CHOICE between its subtypes, not a shape of its own — and this
	 * walk did not know that.** `modelToZod` has had the rule since polymorphism was first supported;
	 * here the base was walked as an ordinary model, so `@discriminator("kind") model Shape` produced
	 * `interface Shape { kind: string; label: string }`.
	 *
	 * Three things were wrong with that at once. The type could not be discriminated, so no consumer
	 * could narrow it; `kind: string` admitted every string the validator rejects; and the subtypes got
	 * no declaration at all, because nothing reached them.
	 *
	 * ⚠️ **It survived because the two walks are only ever compared where a spec declares polymorphism
	 * AND something compiles the emitted assertions.** `wire-contract.gen.ts` exists precisely to catch
	 * the emitter disagreeing with itself — one TypeSpec, walked twice — and this is the second defect
	 * of that class it has found. The first was a vocabulary inlined by one walk and referenced by the
	 * other.
	 */
	const subtypes = discriminatedSubtypes(program, model);
	if (subtypes.length > 0) {
		return subtypes.map((derived) => typeToTs(program, derived)).join(" | ");
	}
	const indexer = effectiveIndexer(model);
	const indexerKey = indexer?.key.name;
	// Inherited properties included — see `inheritedAndOwnProperties`. Both artefacts describe the
	// same model, so a base whose properties reach one and not the other is a contradiction we ship.
	const declared = inheritedAndOwnProperties(model);
	if (indexerKey === "integer" && indexer !== undefined) {
		const element = typeToTs(program, indexer.value);
		// Parenthesised so `A | B` as an element does not become `A | B[]`.
		return /[|&\s]/.test(element) ? `(${element})[]` : `${element}[]`;
	}
	/**
	 * ⚠️ **A string indexer only means "dictionary" when the model declares NO properties.**
	 *
	 * The same trap `modelToZod` had, and it bites harder here: every permissive response model is
	 * `{ …pinned fields; ...Record<unknown> }`, so reading the indexer first would type all 97 of them
	 * as a bare `Record<string, unknown>` — a type that satisfies any assertion about what the response
	 * contains, which is precisely the check this file exists to feed.
	 */
	if (indexerKey === "string" && indexer !== undefined && declared.length === 0) {
		return `Record<string, ${typeToTs(program, indexer.value)}>`;
	}
	/**
	 * ⚠️ **A `never` property is dropped here too, and this walk is where the refusal actually came
	 * from.** `modelToZod` filters it because `@typespec/openapi3` omits such a property from the
	 * document entirely — `model N { value: never; other: string }` publishes as `{other}` with
	 * `required: ["other"]`. This walk had no property filter at all, so it reached `typeToTs`, hit the
	 * `Intrinsic` case and reported `unsupported-type` from a type with no source node — which is why
	 * the diagnostic pointed at `<unknown location>` and why filtering the Zod side alone did not
	 * silence it.
	 *
	 * Two walks over one TypeSpec have to agree about which properties exist, or `wire-contract.gen.ts`
	 * pairs a validator against a type describing a different shape. That assertion is the only thing
	 * that catches this emitter disagreeing with itself, and it cannot catch a disagreement that
	 * aborts the compile first.
	 */
	const entries = declared
		.filter((property) => !isNeverType(property.type))
		.map((property) => `\t${propertyToTs(program, property)}`);
	/**
	 * ⚠️ **The indexer is deliberately NOT intersected in.**
	 *
	 * `{ …pinned } & Record<string, unknown>` looks like the honest rendering of a permissive model,
	 * and it makes the type unsatisfiable: a plain interface has no index signature, so no domain
	 * result can be assignable to it and the assertion this type feeds fails for **every** operation.
	 * A gate that fails for everything is as useless as one that passes for everything.
	 *
	 * Permissiveness is a statement about the VALIDATOR — what it lets through — not about what a
	 * producer must contain. The contract type is the floor: these fields, at least.
	 */
	return entries.length === 0 ? "{}" : `{\n${entries.join("\n")}\n}`;
}

/** A property line, including its optionality marker. */
export function propertyToTs(program: Program, property: ModelProperty): string {
	// The WIRE name, resolved exactly as `zod.ts` resolves it — `wire-contract.gen.ts` asserts the
	// emitted Zod infers this type, so the two must name every property identically or it fails.
	const key = objectKey(resolveEncodedName(program, property, "application/json"));
	// `@encode` changes the wire TYPE, resolved exactly as `zod.ts` resolves it — a property encoded as
	// a string on one side and an array on the other fails the emitted assertion, and deserves to.
	const encoded = getEncode(program, property)?.type;
	const value = typeToTs(program, encoded ?? property.type);
	/**
	 * ⚠️ **A defaulted property is REQUIRED here.**
	 *
	 * `zod.ts` emits `.default(v)`, which makes the field optional on the way *in* and guaranteed on
	 * the way *out*. The assertion this type feeds compares against `z.infer`, which is the output
	 * type — so by the time a value reaches the wire the default has fired and the field is present.
	 * Marking it optional would make a correct schema fail its own assertion.
	 */
	if (property.defaultValue !== undefined) return `${key}: ${value};`;
	// `exactOptionalPropertyTypes` is on, and Zod's `.optional()` infers `T | undefined`.
	return property.optional ? `${key}?: ${value} | undefined;` : `${key}: ${value};`;
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
 * The same walk, except that `type` is never resolved to its own name — see `SchemaRegistry.#inline`
 * for why the "not itself" rule has to sit at the top of the walk rather than inside the resolver.
 */
export function typeToTsBody(program: Program, type: Type): string {
	switch (type.kind) {
		case "Scalar":
			return scalarToTs(program, type);
		case "Model":
			return modelToTs(program, type);
		case "Enum":
			return enumToTs(type);
		case "Union":
			return unionToTs(program, type);
		case "String":
			return JSON.stringify(type.value);
		case "Number":
			return String(type.value);
		case "Boolean":
			return String(type.value);
		case "EnumMember":
			return JSON.stringify(type.value ?? type.name);
		// A named union variant is a referable type — `DogKind.Golden`. See the note in `zod.ts`.
		case "UnionVariant":
			return typeToTs(program, type.type);
		case "Intrinsic":
			if (type.name === "null") return "null";
			if (type.name === "unknown") return "unknown";
			if (type.name === "void" || type.name === "never") {
				return refuse(program, type, `\`${type.name}\` has no runtime representation`);
			}
			return refuse(program, type, `intrinsic "${type.name}"`);
		default:
			return refuse(program, type, "no rule for this kind");
	}
}
