import type { Model, ModelProperty, Program, Type } from "@typespec/compiler";
import { getVisibilitySuffix, Visibility } from "@typespec/http";
import { reportDiagnostic } from "./lib.js";
import { propertyToTs, typeToTsBody, withTsRefResolver } from "./types.js";
import {
	captureBackEdges,
	currentVisibility,
	isTransformedBy,
	noteBackEdge,
	propertyToZod,
	typeToZodBody,
	withRefResolver,
	withSyntheticDeclarations,
} from "./zod.js";

/**
 * Assigns each named TypeSpec model/enum a single Zod declaration, emitted in dependency order.
 *
 * Without this, a model used by twelve operations is inlined twelve times: the generated file grows
 * quadratically, and - worse - the *type* it infers is a fresh structural type at each site, so
 * `apps/web` gets twelve `Company`s that are only accidentally the same. One declaration per model
 * is what makes the emitted types usable as a shared vocabulary rather than as twelve coincidences.
 */

/**
 * **A cycle with no property on its path - and it used to be refused.**
 *
 * **A recursive model is NOT this.** `model InnerModel { children?: InnerModel[] }` is an ordinary
 * tree - `@typespec/openapi3` publishes a self-`$ref` for it and the document is valid - so it is
 * emitted as a reference, made lazy by a getter on the property that closes the loop (see
 * `modelToZod`). What this handles is a cycle with no property to hang a getter on: a named **union**
 * whose variant refers back to a model still being rendered, or a dictionary VALUE that does.
 *
 * **`circular-model` claimed this was unrepresentable, and it was merely unimplemented.** Measured
 * on Zod 4.4.3, `z.lazy()` closes every one of these at run time - a union-variant cycle and a
 * dictionary-value cycle both parse nested values and, importantly, still **reject at depth**, so the
 * schema has not quietly degraded to something that accepts anything.
 *
 * **But `z.lazy()` alone does not TYPECHECK, and that is the whole difficulty.** Measured with
 * `tsc` under `strict`:
 *
 * ```
 * TS7022: 'branchSchema' implicitly has type 'any' because it does not have a type annotation
 *         and is referenced directly or indirectly in its own initializer.
 * TS7022: 'nodeSchema'   implicitly has type 'any' ...        <- it poisons the sibling too
 * ```
 *
 * Inferring `any` is worse than failing to compile, because `wire-contract.gen.ts` asserts
 * `Identical<z.infer<typeof X>, Contracts.X>` - against `any` that assertion PASSES while proving
 * nothing, which is the one outcome this package treats as worse than a red test.
 *
 * The fix is the recipe Zod documents: give the deferred declaration an explicit `z.ZodType<T>` and
 * declare `T` structurally. Measured, `tsc` exit 0 with the identity assertion still holding.
 *
 * **EVERY member of the cycle needs its structural type, not only the deferred one.** Leaving the
 * others as `export type X = z.infer<typeof xSchema>` reintroduces the loop through the annotation -
 * measured: `TS2456: Type alias 'Branch' circularly references itself` plus `TS2502` and `TS7022`. So
 * cycle membership, not merely deferral, decides which declarations are emitted structurally.
 */

interface Declaration {
	readonly identifier: string;
	readonly typeName: string;
	readonly source: string;
	/**
	 * The structural TypeScript body for a declaration on a cycle, emitted INSTEAD of the
	 * `z.infer<typeof ...>` alias - which cannot be used here without closing the type-level loop.
	 */
	readonly structural?: string;
	/** Whether the declaration is annotated `: z.ZodType<typeName>`, which `z.lazy()` requires. */
	readonly annotated?: boolean;
}

/**
 * The name an ANONYMOUS payload model inherits from the single model it spreads.
 *
 * **`@typespec/http` hands back a synthesised model for a body whose declaration carried
 * metadata**, and it has no name - so `@error model InvalidAuth { @statusCode _: 403; error: string }`
 * reached the registry as `{error}` with `name: ""`, was inlined at its use site, and produced **no
 * validator at all** for a component the document publishes as `InvalidAuth`. Four authentication
 * scenarios, each with an unvalidated 403.
 *
 * `@typespec/openapi3` never meets that model: it works from the TypeSpec type and strips metadata
 * itself, which is why its component keeps the original name. This recovers the same name from
 * `sourceModels`, so both artefacts call the shape the same thing.
 *
 * **Only a PURE spread of one named model.** `{...A, extra: string}` is a different shape and must
 * not claim `A`'s name - so every property has to come from the source. Metadata-stripping removes
 * properties and never adds them, which is exactly the asymmetry this tests for. A collision would be
 * caught by the differential's `component-name-collision` arm regardless.
 */
function spreadSourceOf(
	type: Model,
	seen: ReadonlySet<Model> = new Set(),
	/**
	 * The properties the ORIGINAL type has, carried down the chain rather than re-derived.
	 *
	 * **Re-deriving them at each link is what blocked `Alias.InnerModel`.** The intermediate model
	 * an operation builds holds the spread body's properties AND the operation's own `@path` and
	 * `@header` parameters, so checking THAT set against the named ancestor fails on properties the
	 * body never had. The question is whether every property of the shape being named comes from the
	 * ancestor - `{name}` does - not whether some intermediate did.
	 *
	 * The guard is unchanged in what it refuses: `{...A, extra}` still fails, because `extra` is in
	 * the original set and not in `A`.
	 */
	required: readonly string[] = [...type.properties.keys()],
): Model | undefined {
	if (seen.has(type)) return undefined;
	const sources = type.sourceModels;
	if (sources.length !== 1) return undefined;
	const source = sources[0];
	if (source === undefined || source.usage !== "spread") return undefined;
	const model = source.model;
	if (model.templateMapper !== undefined) return undefined;
	for (const property of required) {
		if (!model.properties.has(property)) return undefined;
	}
	/**
	 * **Follow the chain through ANONYMOUS links.** TypeSpec puts an unnamed model between an
	 * operation's parameter model and the model that was spread into it, so stopping at the first
	 * source finds `""` and gives up - measured: the bodies for `Alias.InnerModel` and
	 * `Model.CompositeRequestMix` both reported `sources: [{ usage: "spread", name: "" }]` while the
	 * document published both as components, and the one case that already worked
	 * (`Model.BodyParameter`) was the one whose source happened to be named directly.
	 *
	 * Terminating on an unnamed source with no named ancestor is what keeps a spread ALIAS inline:
	 * OpenAPI names a component for a spread model and not for an alias, and following the chain
	 * reproduces that distinction rather than asserting it.
	 */
	return model.name === "" ? spreadSourceOf(model, new Set([...seen, type]), required) : model;
}

const spreadSourceName = (type: Model): string | undefined => spreadSourceOf(type)?.name;

/**
 * ECMAScript's reserved words, which cannot name a TypeScript declaration.
 *
 * **A model may be named after one, and the corpus declares exactly that on purpose.** `special-words`
 * carries `await`, `break` and the rest, and this emitter wrote `export interface await { ... }` and
 * `export type break = z.infer<...>`, neither of which parses - `TS2427`, then the parser gives up
 * and the whole file is lost.
 *
 * **This is a LIST, which this package otherwise refuses.** It is defensible here because it is
 * not a list about our own code that drifts as the code changes: it is a closed set the language
 * specification fixes. The guard is that `tsc` compiles a fixture declaring models named after these,
 * so a word missing from the list fails a test rather than reaching a consumer - the list is the
 * implementation and the compiler is the oracle.
 *
 * Contextual keywords are deliberately absent, because they are legal: `interface`, `string`,
 * `number`, `any`, `never`, `public` and `yield` all name a type without complaint. Measured, rather
 * than assumed from a language reference.
 */
const RESERVED_DECLARATION_NAMES = new Set([
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"new",
	"null",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
]);

/**
 * The name a declaration is emitted under.
 *
 * A trailing `_` is appended where the spec's own name cannot be a TypeScript declaration. It is
 * applied in ONE place so both walks agree: `wire-contract.gen.ts` pairs a validator against a
 * contract type by name, and a mangling applied to one side only would break that assertion rather
 * than the file.
 */
function safeDeclarationName(name: string): string {
	return RESERVED_DECLARATION_NAMES.has(name) ? `${name}_` : name;
}

/** A type earns a name when the spec gave it one - anonymous shapes stay inline where they are used. */
function declaredNameOf(type: Type): string | undefined {
	if (type.kind === "Enum") return safeDeclarationName(type.name);
	/**
	 * A named union earns a declaration too.
	 *
	 * Without this a union request body is inlined at its use site, so it exports no type - and
	 * `backend/contract.ts` and the wire assertions both pair a model with a schema **by name**. A
	 * cross-field rule modelled as a discriminated union (which is how `@refine` is being replaced)
	 * would silently stop being checked at the boundary.
	 */
	if (type.kind === "Union")
		return type.name === undefined ? undefined : safeDeclarationName(type.name);
	if (type.kind !== "Model") return undefined;
	// `Array`/`Record` are TypeSpec's built-in generic containers, not names worth exporting.
	if (type.name === "Array" || type.name === "Record") return undefined;
	if (type.name === "") {
		const spread = spreadSourceName(type);
		return spread === undefined ? undefined : safeDeclarationName(spread);
	}
	/**
	 * **A template INSTANTIATION carries the template's name, and it is not a declaration.**
	 *
	 * `PublicSuccess<PublicCompanyDetail>` and `PublicSuccess<PublicOfficers>` are both called
	 * `PublicSuccess`, so naming them would export eleven consts called `publicSuccessSchema` - the
	 * file does not compile, and if it did, one shape would validate every response. `@typespec/openapi3`
	 * inlines instantiations for the same reason (the public document has no `PublicSuccess*`
	 * component), so both artefacts agree about what has a name and what does not.
	 *
	 * Invisible until a spec uses a template; a paged-response envelope is the usual first one.
	 */
	if (type.templateMapper !== undefined) return undefined;
	return safeDeclarationName(type.name);
}

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

/**
 * One model can need MORE THAN ONE declaration.
 *
 * **Keyed on `(type, visibility)`, because a model is not one shape.** `@visibility` and HTTP
 * metadata both mean the same declaration projects differently by position: `@typespec/openapi3`
 * emits `VisibilityModel` and `VisibilityModelCreate` as separate components for exactly this
 * reason. Keyed on the type alone, whichever position was walked first won and every other position
 * silently got its shape - measured on the corpus, one strict model carrying all six lifecycle
 * properties, so a create request was required to send read-only fields.
 *
 * The suffix rule is openapi3's: canonical (`Read`) keeps the bare name, and another visibility only
 * earns a suffix when the model is actually TRANSFORMED at it. Same rule, so the identifiers line up
 * with the component names the document publishes.
 */
function keyFor(type: Type, visibility: Visibility): string {
	/**
	 * **Keyed on the SPREAD SOURCE where there is one, or one component gets two declarations.**
	 *
	 * `@typespec/http` synthesises a fresh anonymous model per position, so two operations taking the
	 * same body produce two distinct types that both resolve to the name `BodyModel` - and
	 * `parameters/body-optionality` emitted `export const bodyModelSchema` twice, a file that does not
	 * parse. The document has exactly one `BodyModel` component; collapsing onto the source is what
	 * makes the two artefacts agree about how many things there are.
	 */
	const canonical = canonicalTypeFor(type);
	return `${String(visibility)}\u0000${String((canonical as { name?: string }).name ?? "")}\u0000${identityOf(canonical)}`;
}

/** The model an anonymous payload stands for, so every projection of it shares one declaration. */
function canonicalTypeFor(type: Type): Type {
	if (type.kind !== "Model" || type.name !== "") return type;
	return spreadSourceOf(type) ?? type;
}

/** A stable per-type identity, since two models can share a name across namespaces. */
const identities = new WeakMap<object, number>();
let nextIdentity = 0;
function identityOf(type: Type): number {
	const existing = identities.get(type as object);
	if (existing !== undefined) return existing;
	nextIdentity += 1;
	identities.set(type as object, nextIdentity);
	return nextIdentity;
}

export class SchemaRegistry {
	readonly #program: Program;
	readonly #declarations = new Map<string, Declaration>();
	readonly #order: Declaration[] = [];
	/** Key -> the identifier it is *going* to bind, so a back edge can name a declaration in flight. */
	readonly #inProgress = new Map<string, string>();
	/** Keys on a cycle - every one needs a structural type rather than a `z.infer` alias. */
	readonly #cyclic = new Set<string>();

	constructor(program: Program) {
		this.#program = program;
	}

	/**
	 * The Zod expression for a type - a bare identifier once the type has a declaration, otherwise
	 * inline source. Declaring is depth-first so a model's dependencies are emitted above it, which is
	 * what lets the generated file be plain `const` declarations with no forward references.
	 */
	expressionFor(type: Type): string {
		const bare = declaredNameOf(type);
		if (bare === undefined) return this.#inline(type);
		/**
		 * **A type not reshaped at this visibility IS the canonical declaration - not a copy of it.**
		 *
		 * Keying on the requested visibility while only suffixing transformed types produced two cache
		 * entries sharing one identifier, and the emitted file stopped parsing:
		 * `Identifier 'approvalTierSchema' has already been declared`. An enum is the same enum in a
		 * request and a response. Collapsing onto `Read` first is what makes the key and the name agree,
		 * and it is the same collapse openapi3 performs before naming a component.
		 */
		const requested = currentVisibility();
		const at =
			type.kind === "Model" &&
			requested !== Visibility.Read &&
			isTransformedBy(this.#program, type, requested)
				? requested
				: Visibility.Read;
		const key = keyFor(type, at);
		const existing = this.#declarations.get(key);
		if (existing !== undefined) return existing.identifier;
		/**
		 * **A declaration already in flight is REFERENCED, not re-entered.**
		 *
		 * Returning the identifier is what turns a recursive model into the self-`$ref` the document
		 * publishes. The back edge is noted so the enclosing object knows to defer it behind a getter -
		 * and if nothing does, {@link captureBackEdges} below still sees it and the cycle is named.
		 */
		const pending = this.#inProgress.get(key);
		if (pending !== undefined) {
			noteBackEdge();
			/**
			 * **Every declaration currently in flight is ON this cycle**, and all of them need a
			 * structural type - not only the one that ends up deferred. `#inProgress` is exactly the path
			 * from the cycle's entry point down to here, so recording it wholesale is both correct and
			 * cheap. Recording only the deferred declaration leaves the others as `z.infer` aliases and
			 * closes the loop again at the type level - `TS2456`, measured.
			 */
			for (const inFlight of this.#inProgress.keys()) this.#cyclic.add(inFlight);
			return pending;
		}

		const name = `${bare}${at === Visibility.Read ? "" : getVisibilitySuffix(at, Visibility.Read)}`;
		const identifier = `${lowerFirst(name)}Schema`;

		this.#inProgress.set(key, identifier);
		const rendered = captureBackEdges(() => this.#inline(type));
		this.#inProgress.delete(key);
		/**
		 * A back edge that survived the whole body reached this declaration by a path with no object
		 * property on it - a named union variant, or a dictionary value - so nothing could make it lazy
		 * and the emitted `const` would read itself while initialising. `z.lazy()` defers the whole body
		 * instead, which is the only place left to put the deferral once no property can hold it.
		 */
		const source = rendered.deferred ? `z.lazy(() => ${rendered.value})` : rendered.value;

		const declaration: Declaration = {
			identifier,
			typeName: name,
			source,
			...(this.#cyclic.has(key) ? { structural: this.#structuralBodyOf(type) } : {}),
			...(rendered.deferred ? { annotated: true } : {}),
		};
		this.#declarations.set(key, declaration);
		this.#order.push(declaration);
		this.#declareRelatives(type);
		return declaration.identifier;
	}

	/**
	 * Declare the BASE CHAIN a component's own declaration implies.
	 *
	 * **Reachability from an operation is not the same set the document publishes.** openapi3 emits
	 * a component for every base in an `allOf` chain whether or not an operation names it, so `Pet` and
	 * `Cat` - bases of a `Siamese` that IS named - had no validator at all while the document declared
	 * them.
	 *
	 * **Subtypes are deliberately NOT walked here, because nothing would be walking them.** A
	 * discriminated base renders as `z.discriminatedUnion` over its subtypes, and rendering that
	 * already asks the registry for each one. A loop here looked load-bearing and was measured not to
	 * be: removing it left all 23 polymorphism and differential arms green.
	 *
	 * **Wrapped in {@link captureBackEdges} and the result discarded.** This call can land on a
	 * declaration still in flight - a subtype's base is, by construction, the model that asked for it -
	 * and that is not a reference in anyone's emitted expression. Letting the back edge escape would
	 * have the enclosing declaration report a cycle it does not have and emit `z.never()`.
	 */
	#declareRelatives(type: Type): void {
		if (type.kind !== "Model" || type.baseModel === undefined) return;
		const base = type.baseModel;
		captureBackEdges(() => this.expressionFor(base));
	}

	/**
	 * The Zod for a single property, constraints and optionality included.
	 *
	 * Used for path/query parameters, which are `ModelProperty`s that belong to no model - so they
	 * need the property-level walk rather than the type-level one, or `@minLength` on a path param
	 * would be documented and never enforced.
	 */
	expressionForProperty(property: ModelProperty): string {
		return withRefResolver(
			(candidate) => {
				if (declaredNameOf(candidate) === undefined) return undefined;
				return this.expressionFor(candidate);
			},
			() => propertyToZod(this.#program, property),
		);
	}

	/**
	 * A declaration for a shape the spec never wrote, under a name the document publishes.
	 *
	 * `@discriminated` with an envelope has no TypeSpec type for its wrapper - openapi3 synthesises
	 * one and publishes it as `PetWithEnvelopeCat`, so there is a component with no `Type` to key on.
	 * Keyed by name instead, and pushed in the same dependency-first order as everything else, so the
	 * envelope declarations land above the union that references them.
	 *
	 * `declareNamed` exposes the same seam to the route emitter, which needs it for a **multipart**
	 * body: the document publishes `MultiPartRequest` as a component, and there is no walkable type
	 * for it - the parts have to be assembled from `@typespec/http`'s own view of the payload.
	 */
	declareNamed(name: string, build: () => string): string {
		return this.#declareSynthetic(name, build);
	}

	#declareSynthetic(name: string, build: () => string): string {
		const key = `synthetic\u0000${name}`;
		const existing = this.#declarations.get(key);
		if (existing !== undefined) return existing.identifier;
		const identifier = `${lowerFirst(name)}Schema`;
		if (this.#inProgress.has(key)) return identifier;
		this.#inProgress.set(key, identifier);
		const source = build();
		this.#inProgress.delete(key);
		const declaration: Declaration = { identifier, typeName: name, source };
		this.#declarations.set(key, declaration);
		this.#order.push(declaration);
		return identifier;
	}

	/**
	 * The structural TypeScript body for a type on a cycle.
	 *
	 * **The same walk `requests.gen.ts` uses, resolving named types to their NAMES rather than
	 * declaring them.** A cyclic declaration cannot take its type from `z.infer<typeof ...>` - that is
	 * the loop - so it needs a type written out. Every name this body references is declared in the
	 * same file either structurally (if it is on the cycle too) or as the ordinary `z.infer` alias (if
	 * it is not), so nothing further has to be emitted for it.
	 *
	 * Sharing `types.ts` rather than writing a second TypeScript renderer is what keeps the annotation
	 * agreeing with the validator: those two walks are already paired against each other by
	 * `wire-contract.gen.ts`, and a third spelling of "what this shape is" would be a third thing to
	 * drift.
	 */
	#structuralBodyOf(type: Type): string {
		return withTsRefResolver(
			(candidate) => declaredNameOf(candidate),
			() => typeToTsBody(this.#program, type),
		);
	}

	/**
	 * Render `type` without consulting its own declaration, but letting nested types use theirs.
	 *
	 * **The "not itself" rule belongs to the TOP of the walk, not to every depth.** It used to live
	 * in the resolver, which is asked at every node - so a model reaching itself through a property
	 * was inlined again, and again: `type/array` and `type/dictionary` in the conformance corpus both
	 * declare `children?: InnerModel[]` and both died with
	 * `RangeError: Maximum call stack size exceeded`. Skipping the resolver once, here, is what makes
	 * a nested occurrence resolve to the identifier while the body still renders as a body.
	 */
	#inline(type: Type): string {
		return withRefResolver(
			(candidate) => {
				if (declaredNameOf(candidate) === undefined) return undefined;
				return this.expressionFor(candidate);
			},
			() =>
				withSyntheticDeclarations(
					(name, build) => this.#declareSynthetic(name, build),
					() => typeToZodBody(this.#program, type),
				),
		);
	}

	/** Every declaration, dependencies first. */
	declarations(): readonly Declaration[] {
		return this.#order;
	}
}

export interface TsDeclaration {
	readonly name: string;
	/** `true` when the body is an object literal and can be emitted as an `interface`. */
	readonly isObject: boolean;
	/** `true` for an enum-derived alias - declared but not exported, see below. */
	readonly isVocabulary: boolean;
	readonly source: string;
}

/**
 * The same walk as {@link SchemaRegistry}, emitting plain TypeScript instead of Zod.
 *
 * Kept as a separate class rather than a mode on the schema registry because the two produce
 * different *kinds* of declaration - an `interface` versus a `const` - and their reference resolvers
 * hand back different text. Sharing {@link declaredNameOf} is the part that matters: a model named in
 * one artefact is named the same way in the other, so the emitted assertion can pair them by name.
 */
/**
 * Whether a rendered body is ONE object literal, and so may be emitted as an `interface`.
 *
 * **This was `source.startsWith("{") && !source.includes("} & ")`, which named the two shapes it had
 * met rather than the property it needed.** A discriminated union with an envelope renders as
 * `{ kind: "cat"; value: Cat; } | { kind: "dog"; value: Dog; }`: it starts with a brace and holds no
 * intersection, so it was emitted as `export interface PetWithEnvelope { ... } | { ... }`. An
 * interface cannot be a union, so the file did not parse at all - and that is the DEFAULT envelope,
 * the shape a spec gets from writing `@discriminated` and nothing else.
 *
 * Balanced braces answer the question actually being asked: an interface is valid exactly when the
 * whole body is a single `{...}`, whatever it contains. A composition operator cannot be missed,
 * because anything following the matching close brace fails the test whatever it happens to be.
 */
function isSingleObjectLiteral(source: string): boolean {
	if (!source.startsWith("{")) return false;
	let depth = 0;
	let quoted = false;
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		// A property key may be quoted and may itself contain a brace, which is not a nesting one.
		if (quoted) {
			if (character === "\\") index += 1;
			else if (character === '"') quoted = false;
			continue;
		}
		if (character === '"') quoted = true;
		else if (character === "{") depth += 1;
		else if (character === "}") {
			depth -= 1;
			// Closing the outermost brace anywhere but at the very end means something follows it.
			if (depth === 0) return index === source.length - 1;
		}
	}
	return false;
}

export class TypeRegistry {
	readonly #program: Program;
	readonly #declarations = new Map<Type, TsDeclaration>();
	readonly #order: TsDeclaration[] = [];
	readonly #inProgress = new Set<Type>();

	constructor(program: Program) {
		this.#program = program;
	}

	expressionFor(type: Type): string {
		const name = declaredNameOf(type);
		if (name === undefined) return this.#inline(type);
		const existing = this.#declarations.get(type);
		if (existing !== undefined) return existing.name;
		/**
		 * **No laziness is needed on this side, and no refusal either.** A TypeScript `interface`
		 * may refer to itself - `interface InnerModel { children?: InnerModel[] }` is the ordinary way
		 * to write a tree - so the name alone is the whole answer. The Zod registry has to defer the
		 * same edge behind a getter only because a `const` cannot read itself while initialising.
		 */
		if (this.#inProgress.has(type)) return name;

		this.#inProgress.add(type);
		const source = this.#inline(type);
		this.#inProgress.delete(type);

		const declaration: TsDeclaration = {
			name,
			/**
			 * Only a plain object literal can be an `interface`. A permissive response is
			 * `{ ...pinned } & Record<string, unknown>`, and `export interface X { ... } & ...` does not parse -
			 * so an intersection is emitted as a type alias instead.
			 */
			isObject: isSingleObjectLiteral(source),
			/**
			 * **A vocabulary alias is NOT exported.**
			 *
			 * It restates a vocabulary enum's members from the spec, and the vocabularies artefact already
			 * exports the same 27 names derived from the runtime tuples - exporting both collides on
			 * every one of them the moment the package re-exports this file.
			 *
			 * Restating rather than referencing is deliberate, and it is what makes the drift visible:
			 * the emitted **Zod** defers to the runtime tuple while this type says what the spec
			 * *declares*, so the two disagreeing is exactly the lie the document is telling. Referencing
			 * the contracts type instead would make every assertion pass and publish the lie unchecked -
			 * which is how `FilingState` came to advertise a `failed` state that cannot occur while
			 * omitting the generated one a consumer actually uses.
			 */
			isVocabulary: type.kind === "Enum",
			source,
		};
		this.#declarations.set(type, declaration);
		/**
		 * **Declared once per NAME, not once per `Type`, and the two are not the same thing.**
		 *
		 * `#declarations` is keyed on the `Type` object so a repeated reference resolves without
		 * re-walking. Visibility projection produces a DIFFERENT `Type` for the same declaration, so one
		 * model reached under two visibilities was emitted twice and the file did not compile:
		 * `parameters/body-optionality` declares one `model BodyModel` and `requests.gen.ts` carried two
		 * byte-identical `export interface BodyModel`, from a compile that reported success.
		 *
		 * **Identical is dropped; DIFFERING is a collision and must not be.** Two declarations sharing a
		 * name with different bodies are two different types that TypeScript can only express as one, so
		 * silently keeping the first would publish a contract for a type nothing checks. The document
		 * distinguishes them and this file cannot, which is a refusal rather than a choice.
		 */
		const sameName = this.#order.find((candidate) => candidate.name === declaration.name);
		if (sameName === undefined) {
			this.#order.push(declaration);
		} else if (sameName.source !== declaration.source) {
			reportDiagnostic(this.#program, {
				code: "duplicate-declaration",
				format: { name: declaration.name },
				target: type,
			});
		}
		return declaration.name;
	}

	/**
	 * The Zod-free type for a single property - used for path and query parameters, which are
	 * `ModelProperty`s belonging to no model. Without routing them through the registry a named model
	 * or enum in a parameter position is inlined rather than referenced.
	 */
	/** `wireName` names an HTTP parameter as the wire does - see {@link propertyToTs}. */
	expressionForProperty(property: ModelProperty, wireName?: string): string {
		return withTsRefResolver(
			(candidate) => {
				if (declaredNameOf(candidate) === undefined) return undefined;
				return this.expressionFor(candidate);
			},
			() => propertyToTs(this.#program, property, wireName),
		);
	}

	#inline(type: Type): string {
		return withTsRefResolver(
			(candidate) => {
				if (declaredNameOf(candidate) === undefined) return undefined;
				return this.expressionFor(candidate);
			},
			() => typeToTsBody(this.#program, type),
		);
	}

	/** Every declaration, dependencies first. */
	declarations(): readonly TsDeclaration[] {
		return this.#order;
	}
}
