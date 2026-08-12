/**
 * One normalised description of an object shape, derivable from either artefact.
 *
 * **Why normalise instead of comparing the two representations directly.** The document is JSON
 * Schema and the validator is a Zod object graph; there is no shared vocabulary to diff. Reducing
 * both to the same small record is what makes "these two disagree" a statement about the contract
 * rather than about two encodings. It is also what keeps the comparison honest: anything this record
 * cannot express is a thing the differential silently does not check, so the record is deliberately
 * small and every omission is named.
 *
 * ⚠️ **Not checked yet, and therefore not proven**: `format` (an annotation in JSON Schema 2020-12
 * rather than an assertion, so a validator ignoring it is not in breach), and **the value type of
 * array items and dictionary values**. The first is counted every run so the gap stays a number.
 *
 * ⚠️ **The second is a live hole of exactly the kind that has already hidden two defects.** A
 * property compared as "an array, required, not nullable" agrees with the document whether it holds
 * `Bird` or `string`. Twice now a describer that declined to look at something turned out to be
 * standing in front of a real defect — `allOf` hid 28 components, and reading a discriminated base
 * as an object hid every subtype — so this omission should be read as unexplored, not as safe.
 *
 * Discriminators WERE on this list and are now compared, as a choice rather than as a shape.
 */

/** What the artefact says about properties nobody declared. */
export type Openness =
	| "sealed" // rejects them — `unevaluatedProperties: {not:{}}` / `.strict()`
	| "open" // admits them — `unevaluatedProperties: {}` / `.loose()`
	| "typed" // admits them at a declared type — a catchall
	| "silent"; // says nothing — the document omits the keyword, Zod strips

export interface PropertyShape {
	readonly required: boolean;
	readonly nullable: boolean;
	/** JSON Schema keyword → value. Only keywords BOTH sides can express appear here. */
	readonly constraints: Readonly<Record<string, string | number>>;
	/**
	 * The document's `format`, if it declares one. **Never compared, always counted.**
	 *
	 * JSON Schema 2020-12 defines `format` as an annotation rather than an assertion, so a document
	 * carrying `format: int32` forbids nothing and a validator that ignores it is not in breach. But
	 * "not in breach" is not the same as "enforced", and a consumer generating a client from the
	 * document may well produce an int32-ranged type. The suite reports how many of these go
	 * unenforced so the gap is a number somebody can decide about, rather than a silence.
	 */
	readonly format?: string;
	/** What an array's items or a dictionary's values hold. Absent when the property is neither. */
	readonly element?: ElementType;
	/**
	 * What the property IS — `string`, `array`, `object`. **Absent means unreadable, never "agreed".**
	 *
	 * ⚠️ **Nothing compared this until 2026-08-11, and it is the coarsest fact there is.** Every other
	 * field describes a property whose type both sides already agree on; none of them fire when the
	 * document says `string` and the validator says array. `@encode("csv") value: string[]` is exactly
	 * that — the document publishes `{type: "string"}` because the wire carries `"a,b,c"`, and this
	 * emitter produced `z.array(z.string())`, so a conformant body is rejected.
	 */
	readonly kind?: ElementType;
}

export interface ObjectShape {
	readonly openness: Openness;
	/** Keyed by the name that goes ON THE WIRE — which is the whole point of the `@encodedName` arm. */
	readonly properties: Readonly<Record<string, PropertyShape>>;
}

// --- Zod side -------------------------------------------------------------------------------

interface ZodDef {
	readonly type?: string;
	readonly shape?: Record<string, { _zod?: { def?: ZodDef } }>;
	readonly catchall?: { _zod?: { def?: ZodDef } };
	readonly innerType?: { _zod?: { def?: ZodDef } };
	/**
	 * `z.preprocess` — Zod 4 compiles it to a `pipe`, whose `out` carries the schema being fed and
	 * whose `in` is the transform feeding it. Reading `out` is how a flattened collection parameter's
	 * real shape, and its optionality, are reached at all.
	 */
	readonly out?: { _zod?: { def?: ZodDef } };
	readonly checks?: readonly { _zod?: { def?: Record<string, unknown> } }[];
	readonly entries?: Record<string, unknown>;
	/** `z.discriminatedUnion` — the property it switches on, and the schemas it switches between. */
	readonly discriminator?: string;
	readonly options?: readonly { _zod?: { def?: ZodDef } }[];
	/** `z.literal` — the values it accepts. */
	readonly values?: readonly unknown[];
	/** `z.array` — what it holds. */
	readonly element?: { _zod?: { def?: ZodDef } };
	/** `z.record` — what its values are. */
	readonly valueType?: { _zod?: { def?: ZodDef } };
}

/**
 * What a container holds, named the same way from either artefact.
 *
 * ⚠️ **Without this, `z.array(z.string())` and an array of `Bird` are indistinguishable.** Every
 * other field here describes the property — required, nullable, its own constraints — and all of
 * them agree whatever the elements turn out to be. Two defects have already hidden behind a
 * describer that declined to look at something, so the element type is read rather than assumed.
 *
 * A **declared** type is named (`"Bird"`), because that is the only comparison that means anything
 * across two artefacts: the document writes `$ref` and the validator holds an object reference, and
 * matching them by identity against the emitted module is what turns both into the same word. A type
 * the emitter INLINES — a named scalar carrying a constraint — is reported by its primitive instead,
 * because the document refs it and the validator cannot, and calling that a disagreement would
 * report the emitter's deliberate inlining as a defect.
 */
export type ElementType = string;

/**
 * "The document places no constraint on this value at all" — JSON Schema's empty schema, `{}`.
 *
 * ⚠️ **This is a STATEMENT, and it is not the same as `undefined`.** `undefined` means *we could not
 * read it*; this means *we read it, and it says anything goes*. Conflating the two is what made a
 * validator that OVER-constrains an unconstrained value invisible to this harness: the document side
 * collapsed `{}` to `undefined`, the arm skipped, and the skip counted as coverage.
 *
 * Named `any` rather than `unknown` deliberately. The Zod side called this `"unknown"`, one letter
 * from "unreadable", and the two ideas duly merged. Measured before the rename: typing binary
 * multipart parts as `z.string()` reddened three behavioural arms and **not** this suite.
 */
const ANY: ElementType = "any";

/** Zod's own type names, mapped onto the JSON Schema vocabulary the document uses. */
const ZOD_KINDS: Readonly<Record<string, string>> = {
	string: "string",
	number: "number",
	int: "number",
	bigint: "number",
	boolean: "boolean",
	date: "string",
	object: "object",
	record: "object",
	array: "array",
	tuple: "array",
	null: "null",
	unknown: ANY,
	any: ANY,
	never: "never",
};

const defOf = (schema: unknown): ZodDef | undefined =>
	(schema as { _zod?: { def?: ZodDef } } | undefined)?._zod?.def;

/**
 * `.optional()` is outermost and `.nullable()` sits inside it, because that is the only order that
 * compiles — a constraint after `.optional()` would apply to the optionality rather than the value.
 * Unwrapping in the same order is what lets the constraints underneath be read at all.
 *
 * ⚠️ **A `z.preprocess` wrapper has to be unwrapped too, and not doing so read as a REQUIRED
 * property.** A flattened collection parameter — `?tags=a,b,c`, one string the validator has to split
 * before checking — is emitted as `z.preprocess(split, z.array(z.string()).optional())`. Zod 4
 * compiles that to a `pipe` whose `out` side carries the real schema, so a loop that only knows
 * `optional`/`nullable`/`default` stopped at the wrapper and reported the property as required.
 *
 * ⚠️ **The emitter was right and this describer was wrong, which is the direction that matters.**
 * Measured directly against Zod 4.4.3: the emitted schema's `.isOptional()` is `true` and
 * `safeParse({})` accepts, so a caller omitting the parameter is not rejected. Had this been read as
 * an emitter defect and "fixed" there, a correct validator would have been broken to satisfy a
 * describer — which is why a divergence gets measured against the runtime before anyone edits `src/`.
 */
function unwrap(schema: unknown): {
	def: ZodDef | undefined;
	optional: boolean;
	nullable: boolean;
} {
	let def = defOf(schema);
	let optional = false;
	let nullable = false;
	while (
		def?.type === "optional" ||
		def?.type === "nullable" ||
		def?.type === "default" ||
		def?.type === "pipe"
	) {
		if (def.type === "optional" || def.type === "default") optional = true;
		if (def.type === "nullable") nullable = true;
		// A pipe's `out` is the schema being fed; its `in` is the transform that feeds it.
		def = def.type === "pipe" ? defOf(def.out) : defOf(def.innerType);
	}
	return { def, optional, nullable };
}

/**
 * Zod's check vocabulary → JSON Schema keywords.
 *
 * Read off Zod's own internals rather than the emitted source text: a source-text scan cannot tell
 * `.min(1)` on a string from `.min(1)` on an array, and those are `minLength` and `minItems`. The
 * check names and payloads were measured against zod@4.4.3 rather than assumed —
 * `greater_than` carries `inclusive`, which is the only thing separating `minimum` from
 * `exclusiveMinimum`.
 */
function constraintsOf(def: ZodDef | undefined): Record<string, string | number> {
	const out: Record<string, string | number> = {};
	const lengthKeyword = def?.type === "array" ? "Items" : "Length";
	for (const check of def?.checks ?? []) {
		const c = check._zod?.def;
		switch (c?.check) {
			case "min_length":
				out[`min${lengthKeyword}`] = c.minimum as number;
				break;
			case "max_length":
				out[`max${lengthKeyword}`] = c.maximum as number;
				break;
			case "greater_than":
				out[c.inclusive === true ? "minimum" : "exclusiveMinimum"] = c.value as number;
				break;
			case "less_than":
				out[c.inclusive === true ? "maximum" : "exclusiveMaximum"] = c.value as number;
				break;
			case "string_format":
				// `number_format` (`.int()`) is deliberately absent: it corresponds to `format`, which
				// JSON Schema 2020-12 defines as an annotation rather than an assertion.
				//
				// ⚠️ **`.source`, not `String(...)`.** A `RegExp` stringifies WITH its `/` delimiters, so
				// comparing it against the document's bare pattern reported every single pattern as a
				// disagreement — `/^\S+$/` against `^\S+$`. The delimiters are JavaScript syntax, not part
				// of the expression, and the document has no equivalent of them.
				if (c.format === "regex") out.pattern = (c.pattern as RegExp).source;
				break;
			default:
				break;
		}
	}
	return out;
}

function opennessOfZod(def: ZodDef): Openness {
	const catchall = defOf(def.catchall);
	if (catchall === undefined) return "silent";
	if (catchall.type === "never") return "sealed";
	if (catchall.type === "unknown") return "open";
	return "typed";
}

/** `undefined` when the declaration is not an object — an enum, a union, a dictionary. */
/**
 * Schema object → the name it is declared under, by identity.
 *
 * The emitted module is the only place that mapping exists: at runtime `z.array(birdSchema)` holds
 * an object reference and nothing else, so `Bird` can only be recovered by asking which export IS
 * that object. `birdSchema` → `Bird`.
 */
export type NameResolver = (schema: unknown) => string | undefined;

export function namesFromModule(module: Record<string, unknown>): NameResolver {
	const byIdentity = new Map<unknown, string>();
	for (const [identifier, value] of Object.entries(module)) {
		if (typeof value !== "object" || value === null) continue;
		if (!identifier.endsWith("Schema")) continue;
		const bare = identifier.slice(0, -"Schema".length);
		byIdentity.set(value, `${bare.charAt(0).toUpperCase()}${bare.slice(1)}`);
	}
	return (schema) =>
		typeof schema === "object" && schema !== null ? byIdentity.get(schema) : undefined;
}

/**
 * What a Zod schema IS, in the document's vocabulary — or `undefined` when it cannot be said.
 *
 * ⚠️ **`undefined` must mean "unreadable", not "unconstrained".** A union or a literal has no single
 * JSON Schema type, and guessing one would report disagreements that are artefacts of the guess. The
 * differential counts every skip so the gap cannot pass for coverage.
 */
function zodKind(def: ZodDef | undefined): ElementType | undefined {
	if (def === undefined) return undefined;
	if (def.type === "enum" || def.type === "literal") {
		const values = def.type === "enum" ? Object.values(def.entries ?? {}) : (def.values ?? []);
		if (values.length === 0) return undefined;
		if (values.every((value) => typeof value === "string")) return "string";
		if (values.every((value) => typeof value === "number")) return "number";
		return undefined;
	}
	return ZOD_KINDS[def.type ?? ""];
}

/** What a Zod container holds — a declared name where there is one, else its primitive kind. */
function elementOfZod(def: ZodDef | undefined, name: NameResolver): ElementType | undefined {
	const held =
		def?.type === "array" ? def.element : def?.type === "record" ? def.valueType : undefined;
	if (held === undefined) return undefined;
	// Optionality/nullability of the ELEMENT is not compared; only what it is.
	const { def: inner } = unwrap(held);
	// A union or literal element has no single name; unreadable rather than guessed.
	return name(held) ?? ZOD_KINDS[inner?.type ?? ""] ?? zodKind(inner);
}

export function describeZodObject(
	schema: unknown,
	name: NameResolver = () => undefined,
): ObjectShape | undefined {
	const def = defOf(schema);
	if (def?.type !== "object" || def.shape === undefined) return undefined;
	const properties: Record<string, PropertyShape> = {};
	for (const [propertyName, property] of Object.entries(def.shape)) {
		const { def: inner, optional, nullable } = unwrap(property);
		const element = elementOfZod(inner, name);
		const kind = zodKind(inner);
		properties[propertyName] = {
			required: !optional,
			nullable,
			constraints: constraintsOf(inner),
			...(element === undefined ? {} : { element }),
			...(kind === undefined ? {} : { kind }),
		};
	}
	return { openness: opennessOfZod(def), properties };
}

/**
 * A polymorphic component: the property it switches on, and every value that property may take.
 *
 * ⚠️ **A discriminated base is a CHOICE, and comparing it as an object compares the wrong thing.**
 * The document publishes `Bird` as a component with `discriminator: {propertyName, mapping}`, whose
 * mapping is an instruction to validate against the named subtype; the emitter answers with
 * `z.discriminatedUnion`. Neither is an object shape, so `describeObject` returns `undefined` for
 * both — and a describer that returns `undefined` on the validator side reads as "no validator at
 * all", which is the loudest possible way to be wrong about something that is right.
 */
export interface UnionShape {
	readonly discriminator: string;
	/** Sorted, so two artefacts listing subtypes in different orders still agree. */
	readonly values: readonly string[];
}

/**
 * Every value a schema admits for `key`, looking THROUGH nested unions.
 *
 * `Fish → Shark → SawShark` is the case: `Fish` switches on `kind`, and one of its options is the
 * `Shark` union, which switches on `sharktype`. `Shark`'s contribution to `kind` lives on its own
 * options, both of which say `"shark"` — so the walk has to descend and the values have to be a set.
 */
function discriminatorValues(schema: unknown, key: string, out: Set<string>): void {
	const def = defOf(schema);
	if (def === undefined) return;
	if (def.type === "union") {
		for (const option of def.options ?? []) discriminatorValues(option, key, out);
		return;
	}
	// Reads one property, not the whole shape — enumerating it would fire a recursive model's getters.
	const literal = defOf(def.shape?.[key]);
	for (const value of literal?.values ?? []) {
		if (typeof value === "string") out.add(value);
	}
}

/** `undefined` when the declaration is not a discriminated union. */
export function describeZodDiscriminatedUnion(schema: unknown): UnionShape | undefined {
	const def = defOf(schema);
	if (def?.type !== "union" || typeof def.discriminator !== "string") return undefined;
	const values = new Set<string>();
	discriminatorValues(schema, def.discriminator, values);
	return { discriminator: def.discriminator, values: [...values].toSorted() };
}

// --- Document side --------------------------------------------------------------------------

export interface JsonSchema {
	readonly type?: string | readonly string[];
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	readonly required?: readonly string[];
	readonly unevaluatedProperties?: unknown;
	readonly anyOf?: readonly JsonSchema[];
	readonly allOf?: readonly JsonSchema[];
	readonly oneOf?: readonly JsonSchema[];
	readonly $ref?: string;
	readonly [keyword: string]: unknown;
}

const CONSTRAINT_KEYWORDS = [
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
	"pattern",
] as const;

function opennessOfOne(declared: unknown): Openness {
	if (declared === undefined) return "silent";
	if (typeof declared !== "object" || declared === null) return "typed";
	if ("not" in declared) return "sealed";
	return Object.keys(declared).length === 0 ? "open" : "typed";
}

/**
 * The openness a component **effectively** declares, inherited `allOf` bases included.
 *
 * ⚠️ **A base's `unevaluatedProperties` makes a derived model's `{not: {}}` inert, and that is not a
 * quirk — it is the whole reason OpenAPI 3.1 uses this keyword instead of `additionalProperties`.**
 * Annotations produced inside an `allOf` branch propagate to the parent, so a property the base
 * already evaluated is no longer "unevaluated" by the time the derived model's seal is applied.
 *
 * `model ExtendsFloatAdditionalProperties extends Record<float32> { id: float32 }` is the corpus
 * case: openapi3 emits `unevaluatedProperties: {not:{}}` on the derived and
 * `unevaluatedProperties: {type: number}` on the base. Reading only the derived's declaration says
 * "sealed" and reports a divergence against a validator that is right.
 *
 * Not reasoned out — **measured**, by compiling the emitted document with Ajv 2020-12:
 * `{id: 1, extra: 2}` is accepted and `{id: 1, extra: "s"}` is rejected, so the effective answer is
 * a typed catchall. With a base that declares `{}` an arbitrary extra value is accepted; with a base
 * declaring nothing, the derived's seal bites and an extra is rejected while an inherited property
 * is still allowed.
 */
function opennessOfDocument(schema: JsonSchema, resolve?: RefResolver): Openness {
	const own = opennessOfOne(schema.unevaluatedProperties);
	// A permissive declaration anywhere in the chain wins: it evaluates the properties a seal would
	// otherwise catch. The nearest one is the most specific, so the derived model is asked first.
	if (own === "open" || own === "typed") return own;
	const seen = new Set<string>();
	const fromBases = (node: JsonSchema): Openness | undefined => {
		for (const base of node.allOf ?? []) {
			const ref = base.$ref;
			if (ref !== undefined && seen.has(ref)) continue;
			if (ref !== undefined) seen.add(ref);
			const target = ref === undefined ? base : resolve?.(ref);
			if (target === undefined) continue;
			const openness = opennessOfOne(target.unevaluatedProperties);
			if (openness === "open" || openness === "typed") return openness;
			const deeper = fromBases(target);
			if (deeper !== undefined) return deeper;
		}
		return undefined;
	};
	return fromBases(schema) ?? own;
}

/**
 * A property is nullable when `null` is one of the types it may take.
 *
 * TypeSpec's `string | null` reaches 3.1 as a type array; a union of a `$ref` and null reaches it as
 * an `anyOf` with a `{type: "null"}` arm. Both are the same fact and the validator spells both
 * `.nullable()`, so both have to be read here or the arm reports a disagreement that is not one.
 */
function isNullable(schema: JsonSchema): boolean {
	if (Array.isArray(schema.type)) return schema.type.includes("null");
	return (schema.anyOf ?? []).some((arm) => arm.type === "null");
}

/** Resolves `#/components/schemas/X`, so a property's EFFECTIVE constraints can be read. */
export type RefResolver = (ref: string) => JsonSchema | undefined;

/**
 * The constraints a property effectively carries — its own, over those of anything it `$ref`s.
 *
 * ⚠️ **Following the reference is the whole point, not a shortcut.** A named scalar is where TypeSpec
 * puts a reusable constraint (`@pattern` on `TrimmedString`), the document keeps it on the referenced
 * component, and the emitter **inlines** it at every use. Comparing only what is written on the
 * property therefore compares our inlined copy against nothing at all.
 *
 * This was originally skipped as "a different question". It is not: the effective constraint on the
 * property is exactly the question, and skipping it left the arm reading **2** constraints across
 * the whole corpus and spike while reporting agreement.
 *
 * One level, deliberately. A chain of named scalars each adding a constraint is not something either
 * artefact produces today, and a recursive walk would need cycle handling to earn its keep.
 */
function constraintsOfDocument(
	schema: JsonSchema,
	resolve: RefResolver | undefined,
): Record<string, string | number> {
	const out: Record<string, string | number> = {};
	/**
	 * ⚠️ **A NULLABLE property's constraints live inside its `anyOf`, and this reader used to stop at
	 * the wrapper.** `retiredOn?: IsoDate | null` reaches the document as
	 * `anyOf: [{$ref: IsoDate}, {type: "null"}]`, with the `pattern` on the referenced component —
	 * so reading only the property's own keywords found nothing, and reported the emitter as
	 * enforcing a pattern the document does not state. The emitter was right: it peels nullability
	 * and applies the constraint to what is underneath, which is what `.regex(…).nullable()` means.
	 *
	 * ⚠️ **The gate contradicted itself, which is why this was worth finding before any emitter
	 * defect.** {@link documentKindOf} already peels exactly this wrapper to decide what a property
	 * IS. Reading the type through it and the constraints around it meant the two describers
	 * disagreed about the same schema, and every nullable-and-constrained property in any spec was
	 * ungraded — silently, and in the direction that accuses the emitter.
	 */
	const unwrapped = ((): JsonSchema => {
		const arms = schema.anyOf ?? schema.oneOf;
		if (arms === undefined) return schema;
		const real = arms.filter((arm) => arm.type !== "null");
		// Only a nullable wrapper. A genuine union of two real types has no single set of constraints,
		// and guessing one would be inventing a fact neither artefact states.
		return real.length === 1 && real[0] !== undefined ? real[0] : schema;
	})();
	const target = unwrapped.$ref !== undefined ? resolve?.(unwrapped.$ref) : undefined;
	for (const source of [target, unwrapped, schema]) {
		if (source === undefined) continue;
		for (const keyword of CONSTRAINT_KEYWORDS) {
			const value = source[keyword];
			if (typeof value === "number" || typeof value === "string") out[keyword] ??= value;
		}
	}
	return out;
}

/**
 * Every property a component effectively declares — its own, plus everything it inherits.
 *
 * ⚠️ **`allOf` is inheritance, and skipping it skipped 28 of 226 object components — 12% of the
 * corpus — without reporting a thing.** `model Extension extends Element` reaches OpenAPI as
 * `allOf: [{$ref: Element}]` beside the derived model's own `properties`, and the differential used
 * to return `undefined` for any schema carrying one. Those models were not divergent, they were
 * **absent**: never compared, never counted, invisible in a baseline that looked exhaustive. Behind
 * the hole, `baseModel` turned out to appear nowhere in `src/` at all.
 *
 * The keyword the document uses is `unevaluatedProperties` precisely because it sees through
 * `allOf`, so a sealed derived model means "my properties and my inherited ones, and nothing else".
 * Flattening here is what lets the comparison ask that same question.
 */
function flattenedProperties(
	schema: JsonSchema,
	resolve: RefResolver | undefined,
	seen: ReadonlySet<string> = new Set(),
): { properties: Record<string, JsonSchema>; required: Set<string> } {
	const properties: Record<string, JsonSchema> = {};
	const required = new Set<string>();
	for (const base of schema.allOf ?? []) {
		// Bases first, so a derived model's own declaration of a property wins on the merge below.
		const ref = base.$ref;
		// A cycle through `allOf` is not expressible in TypeSpec, but a resolver is an untrusted input.
		if (ref !== undefined && seen.has(ref)) continue;
		const target = ref === undefined ? base : resolve?.(ref);
		if (target === undefined) continue;
		const inherited = flattenedProperties(
			target,
			resolve,
			ref === undefined ? seen : new Set([...seen, ref]),
		);
		Object.assign(properties, inherited.properties);
		for (const name of inherited.required) required.add(name);
	}
	Object.assign(properties, schema.properties ?? {});
	for (const name of schema.required ?? []) required.add(name);
	return { properties, required };
}

/**
 * What a document property IS, resolving the two wrappers TypeSpec routinely puts around it.
 *
 * A `$ref` to a named scalar is followed, because the emitter inlines those; a nullable property
 * arrives as `anyOf: [T, null]`, and the non-null arm is the type. Anything else — a real union, a
 * composed schema — is `undefined`, meaning **unreadable**, and the differential counts it.
 */
function documentKindOf(
	schema: JsonSchema,
	resolve: RefResolver | undefined,
): ElementType | undefined {
	const ref = schema.$ref;
	if (ref !== undefined) {
		const target = resolve?.(ref);
		return target === undefined ? undefined : documentKindOf(target, resolve);
	}
	const arms = schema.anyOf ?? schema.oneOf;
	if (arms !== undefined) {
		const real = arms.filter((arm) => arm.type !== "null");
		return real.length === 1 && real[0] !== undefined
			? documentKindOf(real[0], resolve)
			: undefined;
	}
	if (schema.allOf !== undefined) return "object";
	return readableKind(schema);
}

/**
 * Every keyword that says something about what a value may BE.
 *
 * A schema carrying none of them, and no `type`, is the empty schema — it permits anything. A
 * schema carrying one we cannot reduce is unreadable, which is a different answer.
 *
 * ⚠️ **`properties`, `items` and `required` are on this list on purpose.** `{properties: {…}}` with
 * no `type` is an object, not an open value; reading it as {@link ANY} would invent agreement with
 * any validator at all — which is the same class of mistake this whole change exists to remove,
 * pointed the other way.
 */
const ASSERTING_KEYWORDS = [
	"type",
	"$ref",
	"anyOf",
	"oneOf",
	"allOf",
	"enum",
	"const",
	"not",
	"properties",
	"items",
	"required",
	"additionalProperties",
	"unevaluatedProperties",
] as const;

/**
 * Whether the document states no constraint on this value whatsoever.
 *
 * Annotations — `description`, `examples`, `contentMediaType`, `format` — are not assertions under
 * 2020-12, so a schema carrying only those is still unconstrained. `contentMediaType` is the real
 * case: it is what openapi3 publishes for an octet-stream body.
 *
 * `{"not": {}}` is the empty set — `never` — and is genuinely readable, but it is unreachable here:
 * a `never`-typed property is refused with `unsupported-type` before it can be compared. It is
 * listed above as asserting, so it reads as unreadable rather than as "anything goes", which is the
 * safe direction.
 */
function isUnconstrained(schema: JsonSchema): boolean {
	return !ASSERTING_KEYWORDS.some((keyword) => keyword in schema);
}

/**
 * JSON Schema's `type` keyword, narrowed to the vocabulary both artefacts share.
 *
 * Returns the sentinel `"unreadable"` where there is no usable `type`; every caller must decide
 * between {@link ANY} and `undefined` by asking {@link isUnconstrained} first, never by testing this
 * value. Reading the sentinel as an answer is the defect this pass removes.
 */
function documentKind(schema: JsonSchema): ElementType {
	const declared = Array.isArray(schema.type)
		? schema.type.find((entry) => entry !== "null")
		: schema.type;
	if (declared === "integer") return "number";
	return typeof declared === "string" ? declared : "unreadable";
}

/** {@link documentKind}, resolved into the three answers a caller may act on. */
function readableKind(schema: JsonSchema): ElementType | undefined {
	if (isUnconstrained(schema)) return ANY;
	const kind = documentKind(schema);
	return kind === "unreadable" ? undefined : kind;
}

/**
 * What a document container holds.
 *
 * ⚠️ **A `$ref` is named only when the emitter would also declare it.** The document refs every
 * named type, including a scalar like `TrimmedString`; this emitter inlines a named scalar's
 * constraints at each use and declares only models, enums and named unions. Naming the scalar here
 * would report that deliberate inlining as a disagreement on every property that uses one — the same
 * trap `constraintsOfDocument` already had to step around.
 */
function elementOfDocument(
	schema: JsonSchema,
	resolve: RefResolver | undefined,
): ElementType | undefined {
	const held =
		documentKind(schema) === "array"
			? (schema.items as JsonSchema | undefined)
			: documentKind(schema) === "object"
				? ((schema.unevaluatedProperties as JsonSchema | undefined) ??
					(schema.additionalProperties as JsonSchema | undefined))
				: undefined;
	if (held === undefined || typeof held !== "object") return undefined;
	const ref = held.$ref;
	if (ref === undefined) return readableKind(held);
	const target = resolve?.(ref);
	// Unreadable — a ref we could not follow says nothing, which is not the same as saying anything.
	if (target === undefined) return undefined;
	const isDeclared =
		target.properties !== undefined ||
		target.allOf !== undefined ||
		target.anyOf !== undefined ||
		target.oneOf !== undefined ||
		target.enum !== undefined ||
		target.discriminator !== undefined;
	// Was `documentKind(target)`, which leaked the raw sentinel out of one path while the others
	// suppressed it — the same value meaning two things, in the one place nobody had noticed.
	if (!isDeclared) return readableKind(target);
	const bare = ref.split("/").at(-1) ?? ref;
	return bare.split(".").at(-1) ?? bare;
}

/**
 * `undefined` unless the component is polymorphic — a `discriminator` that actually maps somewhere.
 *
 * A `@discriminator` base with **no** subtypes carries the keyword and no `mapping`; openapi3 leaves
 * it an ordinary object and so does the emitter, because a union over zero options validates
 * nothing. `mapping` rather than `discriminator` is therefore the test.
 */
export function describeDocumentDiscriminator(schema: JsonSchema): UnionShape | undefined {
	const declared = schema.discriminator;
	if (typeof declared !== "object" || declared === null) return undefined;
	const { propertyName, mapping } = declared as {
		propertyName?: unknown;
		mapping?: Record<string, unknown>;
	};
	if (typeof propertyName !== "string") return undefined;
	if (typeof mapping !== "object" || mapping === null) return undefined;
	return { discriminator: propertyName, values: Object.keys(mapping).toSorted() };
}

/** `undefined` when the component is not a plain object schema — a union, an enum, a scalar. */
export function describeDocumentObject(
	schema: JsonSchema,
	resolve?: RefResolver,
): ObjectShape | undefined {
	// `anyOf`/`oneOf` are unions and genuinely not objects. `allOf` is composition, and is resolved.
	if (schema.anyOf !== undefined || schema.oneOf !== undefined) return undefined;
	if (schema.properties === undefined && schema.allOf === undefined) return undefined;
	const flattened = flattenedProperties(schema, resolve);
	const required = flattened.required;
	const properties: Record<string, PropertyShape> = {};
	for (const [name, property] of Object.entries(flattened.properties)) {
		const target = property.$ref !== undefined ? resolve?.(property.$ref) : undefined;
		const format = property.format ?? target?.format;
		const element = elementOfDocument(property, resolve);
		const kind = documentKindOf(property, resolve);
		properties[name] = {
			required: required.has(name),
			nullable: isNullable(property),
			constraints: constraintsOfDocument(property, resolve),
			...(typeof format === "string" ? { format } : {}),
			...(element === undefined ? {} : { element }),
			...(kind === undefined ? {} : { kind }),
		};
	}
	return { openness: opennessOfDocument(schema, resolve), properties };
}

/**
 * Whether a property's constraints could not be read at all — a `$ref` the resolver could not follow.
 *
 * With a working resolver this is rare; it is counted rather than ignored so "we compared nothing
 * here" stays a visible number instead of an assumption.
 */
export function isUnresolvable(schema: JsonSchema, resolve: RefResolver): boolean {
	return schema.$ref !== undefined && resolve(schema.$ref) === undefined;
}

/**
 * A property's own schema, found through `allOf` as well as on the object itself.
 *
 * ⚠️ **Without this, every INHERITED property was silently skipped, and the skip counted as a
 * comparison.** `describeDocumentObject` already follows `allOf`, so an inherited property appears in
 * the compared shape and its name is checked — but the per-property tail of `compareShapes` looked
 * the schema up again in `json.properties`, where a derived model does not have it. Missing there
 * means "unreadable", so the loop skipped, and **kind, element, format and every constraint went
 * unread for the inherited half of every derived model.**
 *
 * Measured: making one spike model polymorphic took the corpus-wide constraint count from twelve to
 * two, because the constrained properties moved from a compared object onto a base reached only
 * through `allOf`. The only thing that noticed was a non-vacuity floor. `required` and `nullable`
 * were compared throughout, which is exactly why the arm looked alive.
 *
 * Depth-first through `allOf`, resolving each `$ref`, with a `seen` set because a cycle here would
 * hang the suite rather than fail it.
 */
export function propertySchemaOf(
	json: JsonSchema,
	name: string,
	resolve: RefResolver,
	seen: ReadonlySet<JsonSchema> = new Set(),
): JsonSchema | undefined {
	const own = json.properties?.[name];
	if (own !== undefined) return own;
	if (seen.has(json)) return undefined;
	const visited = new Set([...seen, json]);
	for (const member of json.allOf ?? []) {
		const target = member.$ref === undefined ? member : resolve(member.$ref);
		if (target === undefined) continue;
		const found = propertySchemaOf(target, name, resolve, visited);
		if (found !== undefined) return found;
	}
	return undefined;
}
