import {
	getDiscriminatedUnion,
	getDiscriminatedUnionFromInheritance,
	getDiscriminator,
	getDoc,
	getEncode,
	getTypeName,
	ignoreDiagnostics,
	isGlobalNamespace,
	navigateTypesInNamespace,
	resolveEncodedName,
	serializeValueAsJson,
	isNeverType,
	isTemplateDeclaration,
	type Enum,
	type Model,
	type ModelProperty,
	type Namespace,
	type Program,
	type Scalar,
	type Type,
	type Union,
} from "@typespec/compiler";
import {
	createMetadataInfo,
	getCookieParamOptions,
	getHeaderFieldName,
	getVisibilitySuffix,
	getPathParamName,
	getQueryParamName,
	isCookieParam,
	isHeader,
	isPathParam,
	isQueryParam,
	type MetadataInfo,
	Visibility,
} from "@typespec/http";
import { $ } from "@typespec/compiler/typekit";
import { z } from "zod";
import { isReadonlyProperty, shouldInline } from "@typespec/openapi";
import {
	applyConstraints,
	firstReportOf,
	brokenConstraintOf,
	brokenItemsOf,
	hasConstraints,
} from "./constraints.js";
import { literal } from "./literal.js";
import {
	isPublishedSplit,
	isSharedRouteOptional,
	isSuffixedByUsage,
	keptVisibilityOf,
	readVisibilityOf,
} from "./published.js";
import { reportDiagnostic } from "./lib.js";
import { publishesOpenApi30, publishesOpenApi30Only } from "./openapi-versions.js";

/**
 * What a walk returns after reporting a refusal.
 *
 * **Reporting does not unwind, which is the point.** A throw abandoned the compile at the first
 * unrepresentable construct; reporting lets the walk carry on and name every one of them in a single
 * run. The walk still has to return a `string`, and `z.never()` is the honest placeholder: valid
 * Zod, rejects everything, and unreachable in practice because the error diagnostic has already
 * failed the compile that would have written it.
 */
export const UNREPRESENTABLE = "z.never()";

/**
 * **Installed by the registry, which is the only place that knows what a declared type is CALLED.**
 *
 * A property emitted as a getter needs its Zod type written out - see the getter docblock in
 * `modelToZod`. Naming the type is the registry's job (it resolves a named type to its declaration,
 * versioned name included), and `types.ts` already imports this module, so the annotation is handed
 * in rather than computed here.
 */
let annotateDeferred: (
	property: ModelProperty,
	position: PropertyPosition,
) => string | undefined = () => undefined;

/** The same, for a value no property declares: an envelope's `value`, typed as its variant. */
let annotateDeferredType: (type: Type) => string | undefined = () => undefined;

export function withDeferredAnnotator<T>(
	annotator: (property: ModelProperty, position: PropertyPosition) => string | undefined,
	typeAnnotator: (type: Type) => string | undefined,
	run: () => T,
): T {
	const previous = annotateDeferred;
	const previousType = annotateDeferredType;
	annotateDeferred = annotator;
	annotateDeferredType = typeAnnotator;
	try {
		return run();
	} finally {
		annotateDeferred = previous;
		annotateDeferredType = previousType;
	}
}

/**
 * TypeSpec type -> Zod source text.
 *
 * **Deliberately partial, and it fails loudly rather than guessing.** A general TypeSpec->Zod
 * converter has to answer for every construct the language can express; this one only has to answer
 * for the constructs the published document can state, which is what makes it a bounded problem
 * rather than an open-ended dependency. Anything outside that set throws with the offending type
 * named - an emitter that silently produced `z.any()` for a construct it did not understand would
 * push a hole all the way into `respond()`, where the whole point is that drift is caught.
 */

/**
 * External module -> the constants the emitted schemas reference from it.
 *
 * Collected during emission rather than pre-scanned: only the enums actually reachable from an
 * operation should produce an import, and reachability is exactly what the walk already computes.
 *
 * **Scoped to one emission, not module-global-and-cleared.** The previous shape was a module
 * `Map` emptied by whoever read it first, which is correct only while there is exactly one service
 * and one read. A second `@service` namespace would have merged one service's imports into the
 * other's file: an unused import if lucky, a missing one if not. Neither is discoverable while there
 * is only one service, so it is fixed before there are two rather than found by them. Same
 * save/restore idiom as {@link withRefResolver}.
 */
let externalImports: Map<string, Set<string>> | undefined;

/**
 * Enum name -> its declared members, for every vocabulary the surface actually reaches.
 *
 * The spec is the single source for these. Held as tuples in a second package while the spec merely
 * *described* them for the document's benefit, they are two lists that agree only by inspection, and
 * nothing notices when they stop agreeing. Generating them removes the second list.
 */
let vocabularies: Map<string, readonly string[]> | undefined;

/**
 * Whether a model is SEALED - closed to properties nobody declared.
 *
 * **A property of the model's own shape, not of where it is used.** This was previously "the
 * model is reachable from a request body", computed by a whole-graph pre-pass. That rule is wrong in
 * a way that is invisible while it happens to agree: there is one declaration per model, so adding a
 * single operation that accepts `Widget` in a body would flip `widgetSchema` from
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
 * so a project running with sealing off wants schemas that strip rather than reject. That is
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
 * **A project states it twice, here and in openapi3's own options.**
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
 * for one model, and before this the emitter wrote one carrying every lifecycle property at once.
 *
 * **Position is a SECOND axis**: `@header` is metadata at a payload root and ordinary data inside
 * an explicit `@body` - see {@link withMetadataAnnotationsIgnored}, which carries openapi3's third
 * argument to `isPayloadProperty`.
 *
 * Scoped rather than threaded through six signatures, matching the idiom the rest of this module
 * already uses - the walk is deeply recursive and a parameter would have to be carried by every
 * function whether it cared or not.
 */
let visibility: Visibility = Visibility.Read;
/**
 * **One metadata view per program**, because the compiler's state lives on the program. Kept in one
 * module variable, a view built for one compile was read by the next one in the same process -
 * whatever first asked outside a walk left it there - and that program's `@visibility` and `@header`
 * were invisible to it: a create-only or `@header` declaration counted as payload in every compile
 * after the first.
 */
const metadataInfos = new WeakMap<Program, MetadataInfo>();

/**
 * **openapi3's own metadata view: `Read` is canonical, and a read-only property is shareable.**
 *
 * Built with `@typespec/http`'s defaults, the canonical visibility was `All`, so a model whose
 * create-only property is visible at `All` was not transformed at `Create`: its create body
 * collapsed onto the bare declaration, and every response was then validated as the CREATE view -
 * `{name}` refused for want of the `secret` no response carries. And a read-only `id` made a model
 * transformed at `Create`, where openapi3 shares the canonical schema, so the create body was
 * validated without the `id` the document requires. Both are openapi3's arguments in
 * `openapi.js`, passed as it passes them.
 */
export function metadataInfoOf(program: Program): MetadataInfo {
	let info = metadataInfos.get(program);
	if (info === undefined) {
		info = createMetadataInfo(program, {
			canonicalVisibility: Visibility.Read,
			canShareProperty: (property) => isReadonlyProperty(program, property),
		});
		metadataInfos.set(program, info);
	}
	return info;
}

export function withVisibility<T>(next: Visibility, run: () => T): T {
	const previousVisibility = visibility;
	visibility = next;
	try {
		return run();
	} finally {
		visibility = previousVisibility;
	}
}

/** Whether a property is optional AT THE CURRENT POSITION - PATCH makes update fields optional. */
export function isOptionalAt(program: Program, property: ModelProperty): boolean {
	return (
		metadataInfoOf(program).isOptional(property, visibility) ||
		isSharedRouteOptional(property) ||
		(requestReading !== undefined && isReadonlyProperty(program, property))
	);
}

/**
 * **A request read as an OpenAPI 3.0 document reads it: the request's visibility, while the walk is
 * inside one, where openapi3 publishes only 3.0.**
 *
 * openapi3 shares a read-only property into the schema a request is published with - a create body
 * with nothing create-specific IS the canonical schema, `id` required and `readOnly` - and OAS 3.0.4
 * says such a `required` "will take effect on the response only". So at 3.0 a request may leave it
 * out, and the validator lets it, as 0.30.0 did; 0.31.0 read every request as 3.1 does, where
 * `readOnly` is an annotation and `required` holds both ways, and refused every create body leaving
 * out a server-assigned id while openapi3 published 3.0 by default.
 *
 * A declaration a request reads apart from its response is declared again for the request - keyed and
 * named for it, `WidgetCreate` beside `Widget` - see {@link requestReadsApart}.
 */
let requestReading: Visibility | undefined;

export function withRequestReading<T>(program: Program, requested: Visibility, run: () => T): T {
	const previous = requestReading;
	requestReading = publishesOpenApi30Only(program) ? requested : undefined;
	try {
		return run();
	} finally {
		requestReading = previous;
	}
}

/** A declaration's recorded reading, restored to render it again - see `Declaration.reading`. */
export function withRequestReadingAs<T>(reading: Visibility | undefined, run: () => T): T {
	const previous = requestReading;
	requestReading = reading;
	try {
		return run();
	} finally {
		requestReading = previous;
	}
}

/** The request visibility a 3.0 request reading is under, or `undefined` outside one. */
export function requestReadingAt(): Visibility | undefined {
	return requestReading;
}

/**
 * **Whether a type, rendered at `at`, is read apart in a 3.0 request**: it reaches a required
 * read-only property openapi3 publishes in it - through its own and inherited properties, a list's
 * elements, a record's values, a union's members and a discriminated base's subtypes, each at the
 * visibility openapi3 renders it at. Such a type's request reading lets that property be left out
 * and its response reading does not, so the two are two declarations; a type reaching none is one.
 */
export function requestReadsApart(program: Program, type: Type, at: Visibility): boolean {
	return requiredReadOnlyIn(program, type, at, new Set()) !== undefined;
}

/** The first required read-only property `type` reaches at `at` - see {@link requestReadsApart}. */
export function requiredReadOnlyIn(
	program: Program,
	type: Type,
	at: Visibility,
	seen: Set<Type>,
): ModelProperty | undefined {
	if (seen.has(type)) return undefined;
	seen.add(type);
	const inner = (next: Type): ModelProperty | undefined =>
		requiredReadOnlyIn(program, next, renderedVisibilityOf(program, next, at), seen);
	switch (type.kind) {
		case "Model": {
			if (type.indexer !== undefined) {
				const found = inner(type.indexer.value);
				if (found !== undefined) return found;
			}
			const info = metadataInfoOf(program);
			for (const { property } of flattenedPropertiesOf(program, type)) {
				if (!info.isPayloadProperty(property, at, metadataIgnored)) continue;
				if (isReadonlyProperty(program, property) && !property.optional) return property;
				const found = inner(property.type);
				if (found !== undefined) return found;
			}
			for (const derived of type.derivedModels) {
				const found = requiredReadOnlyIn(program, derived, at, seen);
				if (found !== undefined) return found;
			}
			return undefined;
		}
		case "Union":
			for (const variant of type.variants.values()) {
				const found = inner(variant.type);
				if (found !== undefined) return found;
			}
			return undefined;
		case "UnionVariant":
			return inner(type.type);
		case "Tuple":
			for (const value of type.values) {
				const found = inner(value);
				if (found !== undefined) return found;
			}
			return undefined;
		default:
			return undefined;
	}
}

/** Whether a property belongs in the BODY at the current position, rather than being metadata. */
export function isPayloadProperty(program: Program, property: ModelProperty): boolean {
	return metadataInfoOf(program).isPayloadProperty(property, visibility, metadataIgnored);
}

/**
 * **Whether the walk is inside an explicit `@body` whose type carries metadata annotations.**
 *
 * `@header` is metadata at a payload root and ordinary data inside a `@body`: `@typespec/http`
 * ignores the annotation there, and openapi3 renders such a body - and every type under it - with
 * `ignoreMetadataAnnotations`, so `@header("x-code") @maxLength(3) code` is published as a body
 * property with its constraint. Not passed, the property was dropped from the body the document
 * requires it in; and a model's `@header` read as data everywhere enforced its `@maxLength` on a
 * response that never carries it. Both are openapi3's one rule: `body.isExplicit &&
 * body.containsMetadataAnnotations`.
 */
let metadataIgnored = false;

export function withMetadataAnnotationsIgnored<T>(ignored: boolean, run: () => T): T {
	const previous = metadataIgnored;
	metadataIgnored = ignored;
	try {
		return run();
	} finally {
		metadataIgnored = previous;
	}
}

/**
 * **Whether the walk is inside a multipart part whose union holds raw `bytes`**: openapi3 renders
 * such a part in the form's own content type, where a `bytes` member of a union is the raw binary
 * `{}` - any value - rather than a base64 string. `HttpPart<bytes | string>` is `anyOf: [{}, string]`,
 * and validated with `bytes` as a string it refused every file the document accepts. Keyed on by the
 * registries, as a named union published there is a schema of its own.
 */
let multipartBinary = false;

export function withMultipartBinary<T>(binary: boolean, run: () => T): T {
	const previous = multipartBinary;
	multipartBinary = binary;
	try {
		return run();
	} finally {
		multipartBinary = previous;
	}
}

export function multipartBinaryContext(): boolean {
	return multipartBinary;
}

/** `bytes` kept raw, as openapi3's `isBytesKeptRaw` reads it: the standard scalar, not encoded. */
export function isRawBytes(program: Program, type: Type): boolean {
	return type.kind === "Scalar" && type.name === "bytes" && getEncode(program, type) === undefined;
}

/** A union one of whose own members is raw `bytes` - see `withMultipartBinary`. */
export function holdsRawBytes(program: Program, type: Type): boolean {
	return (
		type.kind === "Union" &&
		[...type.variants.values()].some((variant) => isRawBytes(program, variant.type))
	);
}

/** Whether metadata annotations are ignored where the walk is - the registry keys declarations on it. */
export function metadataAnnotationsIgnored(): boolean {
	return metadataIgnored;
}

/** Whether this model or union is shaped differently at `visibility` than at the canonical `Read`. */
export function isTransformedBy(program: Program, type: Model | Union, at: Visibility): boolean {
	return metadataInfoOf(program).isTransformed(type, at);
}

/**
 * **The visibility a type is rendered at where another type refers to it: openapi3's
 * `reduceContext`.** A type that is not transformed at the requested visibility renders at `Read`, so
 * a model with nothing create-specific inside a create body IS the canonical schema - a read-only
 * property shared into it, as `canShareProperty` says. Rendered at the requested visibility under the
 * canonical name, the body dropped that property while the document requires it.
 *
 * **Only where openapi3 reduces.** Its asset emitter asks for a reference context by what it emits:
 * a named model, a model expression, a template instance, a named union, a scalar or an enum. A list -
 * `T[]` or `model Tags is Tag[]` - and a union expression or instance have none, so they keep the
 * visibility they were reached at, and so does everything inside them. Reduced here as well, a
 * `model Tags is Tag[]` sent in a create body and returned was one declaration where the document
 * publishes `TagsCreate` and `Tags`, and a model expression inside a union expression in a create
 * body was judged at `Read`, where openapi3 reads its properties at `Create`.
 */
export function renderedVisibilityOf(
	program: Program,
	type: Type,
	requested: Visibility,
): Visibility {
	if (requested === Visibility.Read) return Visibility.Read;
	switch (type.kind) {
		// A reference to a variant, `U.a`, is its type's - see `publicationOf`.
		case "UnionVariant":
			return renderedVisibilityOf(program, type.type, requested);
		case "Model":
			if (isArrayLiteral(program, type) || isNamedList(type)) return requested;
			return isTransformedBy(program, type, requested) ? requested : Visibility.Read;
		case "Union":
			if (type.name === undefined || type.templateMapper !== undefined) return requested;
			return isTransformedBy(program, type, requested) ? requested : Visibility.Read;
		// A tuple is written out where it is used, each element at the visibility around it.
		case "Tuple":
			return requested;
		default:
			return Visibility.Read;
	}
}

/**
 * **The visibility an operation's body, parameter or response is rendered at: openapi3's
 * `emitTypeWithSchemaEmitter`**, which renders a type at `Read` unless it is transformed at the
 * requested visibility - whatever kind of type it is, a list included.
 */
export function rootVisibilityOf(program: Program, type: Type, requested: Visibility): Visibility {
	if (type.kind === "UnionVariant") return rootVisibilityOf(program, type.type, requested);
	return requested !== Visibility.Read &&
		(type.kind === "Model" || type.kind === "Union") &&
		isTransformedBy(program, type, requested)
		? requested
		: Visibility.Read;
}

/**
 * **Whether openapi3 can name a template instance**: its asset emitter's `declarationName`, which
 * spells each argument's own name after the template's and gives up where one has none - a model
 * expression, a literal, an instance of no nameable arguments. Such an instance is written out where
 * it is used: `Maybe<{ x: string }>` is no component, and declared as `Maybe` it was one name for two
 * schemas wherever a second argument appeared.
 */
export function isSpeakableInstance(type: Type): boolean {
	if (!("templateMapper" in type) || type.templateMapper === undefined) return true;
	return type.templateMapper.args.every((argument) => {
		const each =
			"entityKind" in argument && argument.entityKind === "Indeterminate"
				? argument.type
				: argument;
		if (!("kind" in each)) return false;
		switch (each.kind) {
			case "Model":
			case "Scalar":
			case "Interface":
			case "Operation":
			case "Enum":
			case "Union":
			case "Intrinsic":
				return typeof each.name === "string" && each.name !== "" && isSpeakableInstance(each);
			default:
				return false;
		}
	});
}

/** A named list model, `model Tags is Tag[]`, which openapi3 emits as an `arrayDeclaration`. */
export function isNamedList(type: Model): boolean {
	return (
		type.name !== "" && type.templateMapper === undefined && type.indexer?.key.name === "integer"
	);
}

/**
 * **An array literal's elements are rendered at `Item` visibility**, as openapi3's
 * `arrayLiteralReferenceContext` renders them: PATCH leaves a list's items required, and metadata on
 * an element is data, since no element carries a header. Read at the list's own visibility, a PATCH
 * made every item's properties optional, a `@header` on an element dropped out of the list the
 * document requires it in, and one such model in a request list and a response list was two shapes
 * under one name - `TaggedCreateItem` and `TaggedItem` in the document. A named list model is a
 * declaration, rendered at its own visibility.
 */
export function atItem<T>(program: Program, list: Model, run: () => T): T {
	return isArrayLiteral(program, list) ? withVisibility(visibility | Visibility.Item, run) : run();
}

/**
 * **An array literal, `T[]`, rather than a named list model** - as openapi3's asset emitter tells
 * them apart, by name: a list called `Array` with no properties of its own. A visibility template's
 * copy of `Pet[]` is no standard type, and read as a named list it was declared as `Array`, one
 * name for every such copy.
 */
export function isArrayLiteral(program: Program, list: Model): boolean {
	return $(program).array.is(list) && list.name === "Array";
}

/**
 * **Whether the walk is rendering an operation's parameter or response header itself**, outside any
 * declaration it refers to. A tuple there is refused: openapi3 publishes `prefixItems` over the
 * values the parameter carries, and nothing here reads a parameter's text as positions. A model a
 * parameter refers to is a component the document shares with every other use, and a tuple in it is
 * validated as the document publishes it.
 */
let parameterPosition = false;

export function withParameterPosition<T>(inside: boolean, run: () => T): T {
	const previous = parameterPosition;
	parameterPosition = inside;
	try {
		return run();
	} finally {
		parameterPosition = previous;
	}
}

export function inParameterPosition(): boolean {
	return parameterPosition;
}

/** Why a tuple parameter is refused, and what to write instead - both walks say the same. */
export const TUPLE_PARAMETER = {
	why: "a parameter typed as a tuple, which openapi3 publishes as `prefixItems` over the values it carries and this emitter does not read from the wire",
	remedy: "Declare the parameter as a list of one element type, or carry the value in the body.",
} as const;

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
export function includeDerivedModel(model: Model): boolean {
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
 * Zod walk meant an enum reachable only through an ERROR body was never emitted: an error-code enum
 * declared in the spec and published on every operation's failure responses - the one list a caller
 * branches on - was absent from the generated vocabularies. Walking declarations removes the whole
 * class rather than the instance.
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
 * **This exists because "a `Record` keyed by an enum" is inexpressible, and the workaround costs a
 * duplicated list.** A model naming every known key in the spec is what makes the published document
 * state the constraint instead of hiding it behind a hand-written predicate. But a *type* cannot be
 * iterated, and more than one layer usually needs the set at RUN time - so without this the keys
 * would live in the spec AND as a hand-maintained tuple in a second package: one vocabulary stated
 * twice, which is the drift naming them in the spec exists to prevent.
 *
 * **Selected by an emitter OPTION, deliberately not by a decorator.** A decorator would put a
 * mark in the spec that no document carries. This
 * changes no schema, states nothing in the contract and enforces nothing; it decides which
 * convenience artefact gets written beside the types, which is what an emitter option is for.
 *
 * Wire names, like everything else here: the document publishes one name per property, and a
 * caller checking a key against this tuple is checking what arrived.
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
			inheritedAndOwnProperties(program, model).map((property) =>
				rawPropertyKey(program, property),
			),
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
 * **Not a constant, and not defaulted.** Each `@service` publishes its own contracts
 * package, so a hardcoded specifier makes the second service's schemas import names that package
 * does not export. Scoped the same way the strict-model set is, so a nested emission cannot leak
 * into its parent.
 *
 * **A default package name would be wrong for everyone else.** A project that configured nothing
 * would get validators importing `SPEC_VOCABULARIES` from a package it had never heard of - output
 * that looks right and does not resolve. There is no honest default for "the caller's own
 * package", so the absence is the answer: with no package named, an enum is emitted inline and the
 * output depends on nothing.
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

/**
 * The declaration currently being walked, used to locate a refusal that has nowhere of its own.
 *
 * An intrinsic like `never` has no source node, so pointing a diagnostic at it prints
 * `<unknown location>:1:1`. In a large spec that is a run of byte-identical messages with nothing to
 * grep for and no way to tell which declaration caused which. The property or model being walked
 * when the intrinsic was reached is the thing an author can actually go and edit.
 *
 * Scoped rather than threaded, matching the other ambient facts in this walk.
 */
let declarationSite: Type | undefined;

export function withDeclarationSite<T>(site: Type | undefined, run: () => T): T {
	const previous = declarationSite;
	if (site !== undefined) declarationSite = site;
	try {
		return run();
	} finally {
		declarationSite = previous;
	}
}

/**
 * Where a refusal should point.
 *
 * The offending type, when it has a source location of its own. Otherwise the declaration being
 * walked, which does.
 */
export function refusalTarget(type: Type): Type {
	return (type as { node?: unknown }).node === undefined ? (declarationSite ?? type) : type;
}

/**
 * **The external document a type is published as a reference to**, by `@useRef`: openapi3 writes
 * `$ref: <url>` wherever it is used and no component, so the document states no schema this emitter
 * can read. Read off the decorator applied, as `@typespec/openapi3`, which declares it, is no
 * dependency of this package.
 */
export function externalReferenceOf(type: Type): string | undefined {
	if (!("decorators" in type)) return undefined;
	const applied = type.decorators.find((each) => each.decorator.name === "$useRef");
	if (applied === undefined) return undefined;
	const [argument] = applied.args;
	return typeof argument?.jsValue === "string" ? argument.jsValue : "an external document";
}

/** Refuse a type the document publishes only as a reference to another document. */
export function refuseExternalReference(program: Program, type: Type, url: string): string {
	return refuse(
		program,
		type,
		`it is published as a reference to ${url}, whose schema the document does not state`,
		"Remove '@useRef' to have the document and this validator state the model, or validate the value yourself where it is used.",
	);
}

/** Refuse `type`, pointing at its declaration, and carry on so the rest is reported too. */
function refuse(program: Program, type: Type, why: string, remedy = ""): string {
	// Once per declaration, whichever walk reaches it first: both walk every type.
	const target = refusalTarget(type);
	if (firstReportOf(program, "unsupported-type", target, `${type.kind} ${why}`)) {
		reportDiagnostic(program, {
			code: "unsupported-type",
			target,
			format: { artefact: "Zod", kind: type.kind, why, remedy },
		});
	}
	return UNREPRESENTABLE;
}

/**
 * Whether a JSON value passes the check a standard scalar emits, asked of that very check: the
 * table below is code this module writes, so it is compiled once here with the same Zod and run,
 * rather than restated as a second set of rules that could drift from it. `undefined` where the
 * scalar has no standard base or no entry.
 */
const scalarChecks = new Map<string, z.ZodType>();
function scalarAccepts(program: Program, scalar: Scalar, json: unknown): boolean | undefined {
	/**
	 * **A scalar `@encode`d where it is declared is checked as the scalar it is encoded as**, as
	 * `scalarSchemaOf` validates it: `@encode(unixTimestamp, int32) scalar Ts` holds `1577836800`, and
	 * asked of `utcDateTime`'s ISO check the default `Ts.fromISO(...)` publishes was refused.
	 */
	const encoding = scalarEncodingOf(program, scalar);
	if (encoding !== undefined) {
		return program.checker.isStdType(encoding.encoded)
			? scalarAccepts(program, encoding.encoded, json)
			: undefined;
	}
	const base = standardBaseOf(program, scalar);
	const source = base === undefined ? undefined : SCALARS[base.name];
	if (base === undefined || source === undefined) return undefined;
	let check = scalarChecks.get(base.name);
	if (check === undefined) {
		check = new Function("z", `return ${source};`)(z) as z.ZodType;
		scalarChecks.set(base.name, check);
	}
	return check.safeParse(json).success;
}

/**
 * **The Zod a standard scalar becomes, or `undefined` for any other scalar** - looked up only for
 * the standard library's own: a spec's `scalar uint8 extends string` is a string, and found in this
 * table by its name it was validated as a byte, refusing every string the document accepts.
 */
export function standardScalarSchemaOf(program: Program, scalar: Scalar): string | undefined {
	return program.checker.isStdType(scalar) ? SCALARS[scalar.name] : undefined;
}

/** Scalars we accept, and the Zod they become. Keyed by the TypeSpec scalar's declared name. */
const SCALARS: Readonly<Record<string, string>> = {
	string: "z.string()",
	boolean: "z.boolean()",
	bytes: "z.string()",
	/**
	 * **A declared WIDTH is a claim about the value too, and ten of them used to share one check.**
	 *
	 * Every integer scalar emitted `z.number().int()`, which is "an integer within the safe range" and
	 * nothing more. Measured at the wire on `workerd`, against a document publishing the widths below:
	 * a `uint8` accepted `-5` and `100000`, an `int32` accepted `3000000000` and `-3000000000`.
	 *
	 * The differential oracle cannot see it. JSON Schema 2020-12 treats `format` as an annotation, so
	 * Ajv on the published document answers VALID for all of those and agrees with the server while
	 * both are wrong. Ajv says so out loud: `unknown format "uint8" ignored`.
	 *
	 * Zod 4 has the named formats for the two widths that have them, and they emit better JSON Schema
	 * than a bare bound would. The rest take explicit bounds.
	 *
	 * **`int64` and `uint64` keep the safe-integer ceiling, and that is a limit rather than a
	 * choice.** `JSON.parse` has already lost a value above 2^53 before any validator runs, so the
	 * alternatives are to refuse it or to accept a number that is not the one the caller sent.
	 * Refusing is the honest one. `z.int64()` exists but is a `bigint`, which a JSON body cannot
	 * carry. What changes here is only that `uint64` stops accepting negatives.
	 */
	int8: "z.int().min(-128).max(127)",
	int16: "z.int().min(-32768).max(32767)",
	int32: "z.int32()",
	int64: "z.int()",
	safeint: "z.int()",
	uint8: "z.int().min(0).max(255)",
	uint16: "z.int().min(0).max(65535)",
	uint32: "z.uint32()",
	uint64: "z.int().min(0)",
	integer: "z.int()",
	float: "z.number()",
	float32: "z.number()",
	float64: "z.number()",
	decimal: "z.number()",
	decimal128: "z.number()",
	numeric: "z.number()",
	/**
	 * **A declared TYPE is a claim about the value, and these check it.**
	 *
	 * These are not strings with a hint attached: they are scalars the document publishes as
	 * `format: date-time`, `format: uri` and so on. Emitting `z.string()` for them discarded a
	 * declared type, so a service promising a timestamp accepted `banana` - and an author who wanted
	 * the check had to rewrite the spec as `string` with a `@pattern`, losing `format: date-time` from
	 * the document AND getting a weaker check, since a hand-written pattern accepts `2026-02-31`. A
	 * rule that pushes authors into writing worse specs is the wrong rule.
	 *
	 * **`@format("...")` on a plain string is a different case and stays unenforced.** Under JSON
	 * Schema 2020-12, which OpenAPI 3.1 uses, `format` is an annotation rather than an assertion, so
	 * enforcing an author's hint would add a rule the contract does not state, and
	 * `@format("product-code")` proves no general rule exists. A type is a claim; an annotation is a
	 * hint.
	 *
	 * **`{ offset: true }` is measured, not decorative.** A stricter check risks failing a legal
	 * instant: a bare `z.iso.datetime()` REJECTS `2026-08-14T12:00:00+01:00`, which is valid RFC 3339
	 * and valid `format: date-time`. With the offset permitted, every legal instant is accepted and
	 * only `2026-02-31` and `banana` are refused. `local: true` would go too far, admitting a value
	 * with no timezone at all, which RFC 3339 does not allow.
	 */
	utcDateTime: "z.iso.datetime({ offset: true })",
	offsetDateTime: "z.iso.datetime({ offset: true })",
	plainDate: "z.iso.date()",
	plainTime: "z.iso.time()",
	duration: "z.iso.duration()",
	url: "z.url()",
};

function scalarToZod(program: Program, scalar: Scalar): string {
	return described(scalarSchemaOf(program, scalar), scalarDocOf(program, scalar));
}

/**
 * **A doc becomes `.describe()`, which is the one place Zod keeps a description.**
 *
 * `@typespec/openapi3` writes every `getDoc` as a JSON Schema `description`, and nothing carried it
 * into the validators: a surface publishing its input schema FROM them - an MCP server's
 * `tools/list` - gave a model calling a tool bare patterns and enums with no word on what a field is
 * for, and a client checking that published schema before it calls refuses what it cannot explain.
 *
 * `.describe()` records the text in `z.globalRegistry`, which is a `globalThis` singleton shared by
 * every copy of Zod in a process, and both `z.toJSONSchema` and Zod's Standard Schema converter read
 * it by default. It returns a clone and changes nothing a parse decides.
 *
 * **It is always the OUTERMOST call at a position, and never on a bare reference.** Inside
 * `.nullable()` the text lands in `anyOf[0]` rather than on the property; on an identifier inside
 * `z.array()` or a union it would clone a declaration that other code finds by identity. So it is
 * applied where a declaration's body, a property's value or a scalar's schema is finished, and
 * nowhere else.
 *
 * Gated on `undefined` rather than on truthiness, as openapi3's `applyConstraint` is: an empty
 * `@doc("")` is published as `""`, and so is it here.
 */
export function described(expression: string, doc: string | undefined): string {
	return doc === undefined ? expression : `${expression}.describe(${literal(doc)})`;
}

/**
 * The description a declared scalar publishes: its own doc, else the nearest one up its `extends`
 * chain, and never a standard type's.
 *
 * Both halves are openapi3's, from `#getSchemaForScalar`: a derived scalar starts from its base's
 * schema, description included, and overwrites what it declares itself - so `scalar B extends A`
 * with no doc publishes A's. A standard scalar's description is deleted, because "standard types are
 * going to be inlined in the spec and we don't want the description of the scalar to show up".
 * Without that, `string`'s own "A sequence of textual characters." would sit on every `z.string()`.
 */
export function scalarDocOf(program: Program, scalar: Scalar): string | undefined {
	for (
		let current: Scalar | undefined = scalar;
		current !== undefined && !program.checker.isStdType(current);
		current = current.baseScalar
	) {
		const doc = getDoc(program, current);
		if (doc !== undefined) return doc;
	}
	return undefined;
}

/**
 * **The `@encode` a scalar is published under: its own, or the nearest one up its `extends` chain.**
 *
 * openapi3 builds a scalar that is not standard from its base's schema - encoding included - and
 * then applies its own decorators over it, so `scalar TsChild extends Ts` with
 * `@encode(unixTimestamp, int32)` on `Ts` is published as an integer, exactly as `Ts` is. This read
 * the scalar's own `@encode` alone, so `TsChild` was validated as an ISO date-time string, refusing
 * every value the document accepts and accepting every value it refuses. `link` is the scalar that
 * declares the encoding.
 */
export function scalarEncodingOf(
	program: Program,
	scalar: Scalar,
): { readonly link: Scalar; readonly encoded: Scalar } | undefined {
	for (let link: Scalar | undefined = scalar; link !== undefined; link = link.baseScalar) {
		const encoded = encodedTypeOf(program, link);
		if (encoded !== undefined) return { link, encoded };
	}
	return undefined;
}

/** A scalar's schema without its description, for a position that publishes its own. */
function scalarSchemaOf(program: Program, scalar: Scalar): string {
	// `scalar unixTimestamp32 is utcDateTime;` with `@encode(int32)` on the SCALAR, not on each use.
	const encoding = scalarEncodingOf(program, scalar);
	if (encoding !== undefined) {
		const { link, encoded } = encoding;
		/**
		 * **An encoding to a scalar that is not standard publishes no type**, so there is no wire form
		 * to validate - including a scalar encoded as itself, which openapi3 publishes as
		 * `{ format: "y" }` alone. A scalar from the standard library carries no `@encode` of its own,
		 * so refusing this at the first link is also what ends every chain: `Ping -> Pong -> Ping` is
		 * refused at `Ping`, where it used to be followed until the stack overflowed.
		 */
		if (!program.checker.isStdType(encoded)) {
			reportUnsatisfiableEncoding(program, link, {
				name: link.name,
				declared: link.baseScalar?.name ?? link.name,
				encoded: encoded.name,
				why: "typeless",
			});
			return UNREPRESENTABLE;
		}
		/**
		 * The constraints are read from the scalar named, up its chain, and each one the encoded type
		 * cannot carry is dropped and reported by `applyConstraints`: openapi3 applies them BEFORE the
		 * encoding replaces `type`, so a `@pattern` on a string encoded as `int32` is published beside
		 * `type: integer`, where JSON Schema ignores it. Applied, it emitted `z.int32().regex(...)`,
		 * and the module threw on import.
		 */
		return applyConstraints(program, scalarSchemaOf(program, encoded), scalar);
	}
	let current: Scalar | undefined = scalar;
	// Walk the `extends` chain so a named scalar (`scalar isbn extends string`) resolves to the
	// primitive it is built on rather than being rejected for having a project-specific name.
	while (current !== undefined) {
		const mapped = standardScalarSchemaOf(program, current);
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
		return `z.union([${values.map((value) => `z.literal(${literal(value)})`).join(", ")}])`;
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
	 * Inline unless the project named a package to share the tuple through.
	 *
	 * The indirection exists so a SECOND package - another layer, a client - can branch on the same
	 * values without restating them. A project with no such package wants a self-contained
	 * validator, and emitting a reference to one it never configured is the only way to get output
	 * that cannot resolve.
	 */
	const shared = contractsPackage();
	if (shared === undefined) {
		return `z.enum([${values.map((value) => literal(value)).join(", ")}])`;
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
let declareSynthetic: ((name: string, build: () => string, site: Type) => string) | undefined;

export function withSyntheticDeclarations<T>(
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

const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * **Why a variant of an envelope-less `@discriminated` union cannot be dispatched to by its wire
 * discriminator, or `undefined` where it can.** The variant must carry the discriminator under its
 * WIRE name, as one fixed value. Matched on the TypeSpec name as well, a variant whose `kind` was
 * renamed `t` passed, and the module threw "Invalid discriminated union option" on import; one
 * inheriting an open `type: string` threw on every parse.
 */
export function undeclaredVariantOf(
	program: Program,
	variant: Type,
	property: string,
): "missing" | "open" | "refused" | undefined {
	if (variant.kind !== "Model") return "missing";
	const entry = publishedPropertiesOf(program, variant).find(
		(candidate) => rawPropertyKey(program, candidate.property) === property,
	);
	if (entry === undefined) return "missing";
	if (fixedValuesOf(entry.property.type) === undefined) return "open";
	// A value a declaration above the variant refuses: no value is one.
	return positionOf(program, variant, entry).never ? "refused" : undefined;
}

/**
 * **The variants a `@discriminated` union dispatches to: each but one no value can be.**
 *
 * A variant without an envelope that accepts nothing - its fixed discriminator refused by a
 * declaration above it, `kind: "cobra"` under `@maxLength(3) kind: string`, or a key it requires
 * refused by a base openapi3 seals - is published by the document as a member no value satisfies, and
 * a `oneOf` with such a member accepts what the others accept. Refusing the union for it refused every
 * `asp` the document accepts, and dispatching to it put a `z.never()` where Zod reads a literal: the
 * first parse threw "Invalid discriminated union option".
 */
export function dispatchedVariantsOf(program: Program, union: Union): readonly [string, Type][] {
	const [discriminated] = getDiscriminatedUnion(program, union);
	if (discriminated === undefined) return [];
	const { envelope, discriminatorPropertyName } = discriminated.options;
	return [...discriminated.variants.entries()]
		.map(([name, variant]): [string, Type] => [String(name), variant])
		.filter(
			([, variant]) =>
				envelope !== "none" ||
				/**
				 * A refused discriminator leaves values where it may be left out: under a PATCH,
				 * `NCUpdate` accepts `{}`, which matches `NAUpdate` too, so the document's `DNUpdate`
				 * refuses it. Dropped, `DNUpdate` was `NAUpdate` and accepted it.
				 */
				((undeclaredVariantOf(program, variant, discriminatorPropertyName) !== "refused" ||
					optionalDiscriminator(program, union, variant, discriminated.options)) &&
					!(variant.kind === "Model" && acceptsNothing(program, variant)) &&
					!isPublishedSplit(program, variant, renderedVisibilityOf(program, variant, visibility))),
		);
}

/** A model no value is, refused on its own - `invalid-subtype-discriminator`, `sealed-base-extended`. */
function acceptsNothing(program: Program, model: Model): boolean {
	return (
		unsatisfiableSubtype(program, model) || sealedBaseExtensionOf(program, model)?.required === true
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
/**
 * **Whether a required property is optional at `at`**: a PATCH with implicit optionality, outside a
 * list's elements - `@typespec/http`'s `isOptional`, for a property with no declaration of its own
 * to ask, as an envelope's are.
 */
export function implicitlyOptional(at: Visibility): boolean {
	return (
		(at & Visibility.Update) !== 0 && (at & Visibility.Patch) !== 0 && (at & Visibility.Item) === 0
	);
}

/**
 * **The visibility an envelope is published at, within a union rendered at the current one.**
 * openapi3 synthesises the envelope as a model of two properties - the discriminator and the variant
 * - and emits it from the union's context, which reduces it to `Read` unless it is transformed
 * there: where the variant is, or where a PATCH makes both its properties optional. Read as one
 * envelope for every visibility, a PATCH body was held to the read wrapper's required `kind` and
 * `value`, and a response to the create wrapper's variant.
 */
export function envelopeVisibilityOf(program: Program, union: Union, variant: Type): Visibility {
	/**
	 * **The union is reduced first**, as openapi3 reduces any reference to it: a union not
	 * transformed where it is reached is emitted at `Read`, its envelopes with it. Spelled out inside a
	 * merge under a PATCH, `DU { a: A, b: B }` of all-optional variants had its envelopes' `kind` and
	 * `value` made optional, where the document's `DUA` requires both.
	 */
	const at = renderedVisibilityOf(program, union, visibility);
	if (at === Visibility.Read) return Visibility.Read;
	const reshaped =
		(variant.kind === "Model" || variant.kind === "Union") && isTransformedBy(program, variant, at);
	return reshaped || implicitlyOptional(at) ? at : Visibility.Read;
}

/** Whether a variant's discriminator may be absent where the union is rendered - see `unionToZod`. */
export function optionalDiscriminator(
	program: Program,
	union: Union,
	variant: Type,
	options: { envelope: string; discriminatorPropertyName: string },
): boolean {
	if (options.envelope !== "none")
		return implicitlyOptional(envelopeVisibilityOf(program, union, variant));
	if (variant.kind !== "Model") return false;
	const at = renderedVisibilityOf(program, variant, visibility);
	const property = inheritedAndOwnProperties(program, variant).find(
		(each) => each.name === options.discriminatorPropertyName,
	);
	return property !== undefined && (property.optional || implicitlyOptional(at));
}

function discriminatedVariant(
	program: Program,
	union: Union,
	variantName: string,
	variant: Type,
	options: { envelope: string; discriminatorPropertyName: string; envelopePropertyName: string },
): string {
	const { value: inner, deferred } = captureBackEdges(() => typeToZod(program, variant));
	const envelopeAt = envelopeVisibilityOf(program, union, variant);
	const optional = implicitlyOptional(envelopeAt) ? ".exactOptional()" : "";
	const tag = `${objectKey(options.discriminatorPropertyName)}: z.literal(${literal(variantName)})${optional}`;
	// The variant already carries the discriminator, so the document publishes it and there is
	// nothing to add.
	if (options.envelope === "none") {
		if (deferred) noteBackEdge();
		return inner;
	}
	/**
	 * **A variant still being declared is reached through a getter**, as an object's member is: the
	 * wrapper is a declaration of its own, and read eagerly it met `catSchema` before its `const` -
	 * "Cannot access 'catSchema' before initialization" on import, for a `Cat` that refers back to the
	 * union through its own properties.
	 */
	const key = objectKey(options.envelopePropertyName);
	const value = deferred
		? `get ${key}()${optional === "" ? (annotateDeferredType(variant) ?? "") : ""} { return ${inner}${optional}; }`
		: `${key}: ${inner}${optional}`;
	const wrapper = `${sealObjectSchemas ? "z.strictObject" : "z.object"}({ ${tag}, ${value} })`;
	const name = envelopeNameOf(program, union, variantName, variant);
	if (name === undefined) return wrapper;
	return declareSynthetic?.(name, () => wrapper, union) ?? wrapper;
}

/**
 * **The component openapi3 publishes an envelope as**: the union's name and the variant's, suffixed
 * with the envelope's visibility where the union - whose usage openapi3 gives the envelope - is used
 * at more than one. None for a union with no name, whose envelopes are written out where it is.
 */
export function envelopeNameOf(
	program: Program,
	union: Union,
	variantName: string,
	variant: Type,
): string | undefined {
	if (union.name === undefined) return undefined;
	const envelopeAt = envelopeVisibilityOf(program, union, variant);
	const suffixed = envelopeAt !== Visibility.Read && isSuffixedByUsage(union);
	return `${union.name}${capitalise(variantName)}${suffixed ? getVisibilitySuffix(envelopeAt, Visibility.Read) : ""}`;
}

/**
 * **Why the OpenAPI 3.0 document refuses a `null` the spec admits**, or `undefined` where it does not -
 * asked only where openapi3 publishes 3.0. Read off openapi3's 3.0 `unionSchema` and OAS 3.0.4's
 * `nullable`, which "only takes effect if `type` is explicitly defined within the same Schema Object",
 * while "Other Schema Object constraints retain their defined behavior":
 *
 * - Each JSON kind of literal is one `{ type, enum }` member, and the `enum` refuses `null`.
 * - **One member**, or any member a `$ref`, is written with `nullable` beside it: a `$ref` is wrapped
 *   as `{ type?, allOf: [$ref], nullable }` and the component refuses `null` unless it has no type; an
 *   inline schema admits it where it carries a `type` - a standard scalar, a list, a record, a model
 *   expression - or none at all.
 * - **Several inline members** are `{ anyOf: [...], nullable: true }`, with no `type`, so `nullable`
 *   does nothing and only a member admitting `null` on its own does.
 * - A bare `null` is `{ nullable: true }` - any value - and a union of nothing but `null` is refused by
 *   openapi3 itself, as `union-null`.
 */
export function unpublishableNullWhy(program: Program, type: Type): string | undefined {
	if (!publishesOpenApi30(program)) return undefined;
	if (type.kind === "Intrinsic" && type.name === "null") {
		return "a bare 'null' is published as '{ nullable: true }', which is any value";
	}
	if (type.kind !== "Union" || getDiscriminatedUnion(program, type)[0] !== undefined)
		return undefined;
	const variants = [...type.variants.values()].map((variant) => variant.type);
	if (!variants.some(isNull)) return undefined;
	const real = variants.filter((variant) => !isNull(variant));
	if (real.length === 0) {
		return "a union of nothing but 'null' has no 3.0 schema, and openapi3 refuses it as 'union-null'";
	}
	if (admitsNullAt30(program, type, new Set())) return undefined;
	const referenced = real.some((member) => publishedAsReference(program, member));
	return referenced
		? "'nullable' is published beside a reference, which still refuses null - OAS 3.0.4 lets 'nullable' take effect only beside 'type', and keeps every other constraint"
		: "'nullable' is published beside an 'enum' or an 'anyOf' that refuses null - OAS 3.0.4 lets 'nullable' take effect only beside 'type', and keeps every other constraint";
}

/** Whether openapi3's 3.0 schema for `union` admits `null` - see {@link unpublishableNullWhy}. */
function admitsNullAt30(program: Program, union: Union, seen: Set<Type>): boolean {
	if (seen.has(union)) return false;
	seen.add(union);
	const variants = [...union.variants.values()].map((variant) => variant.type);
	const nullable = variants.some(isNull);
	const real = variants.filter((variant) => !isNull(variant));
	const literal = (member: Type): boolean =>
		member.kind === "EnumMember" ||
		(member.kind !== "UnionVariant" && literalValueOf(member) !== undefined);
	const members = real.filter((member) => !literal(member));
	const groups = new Set(real.filter(literal).map((member) => member.kind)).size;
	const wrapped =
		nullable &&
		(members.length + groups === 1 ||
			members.some((member) => publishedAsReference(program, member)));
	return members.some((member) => memberAdmitsNullAt30(program, member, wrapped, seen));
}

/** Whether one member of a 3.0 union admits `null`, with `nullable` beside it or not. */
function memberAdmitsNullAt30(
	program: Program,
	member: Type,
	wrapped: boolean,
	seen: Set<Type>,
): boolean {
	if (member.kind === "UnionVariant")
		return memberAdmitsNullAt30(program, member.type, wrapped, seen);
	if (isTypelessMember(program, member)) return true;
	if (publishedAsReference(program, member)) {
		// The component answers: a named union by its own members, anything else typed and refusing.
		return member.kind === "Union" && admitsNullAt30(program, member, seen);
	}
	if (member.kind === "Union") return admitsNullAt30(program, member, seen);
	// Inline and typed - a standard scalar, a list, a record, a model expression: `nullable` beside it.
	return wrapped;
}

/**
 * **Whether openapi3 publishes `type` as a `$ref` to a component**: a named model, enum or named union
 * it can name, and a scalar outside the standard library. Everything else it writes out where it is
 * used. Mirrors `declaredNameOf`, plus scalars, which this emitter validates inline and openapi3
 * declares.
 */
function publishedAsReference(program: Program, type: Type): boolean {
	switch (type.kind) {
		case "UnionVariant":
			return publishedAsReference(program, type.type);
		case "Enum":
			return true;
		case "Union":
			return type.name !== undefined && isSpeakableInstance(type) && !shouldInline(program, type);
		case "Scalar":
			return !program.checker.isStdType(type);
		case "Model":
			return (
				type.name !== "" &&
				!isArrayLiteral(program, type) &&
				!(type.name === "Record" && program.checker.isStdType(type)) &&
				isSpeakableInstance(type) &&
				!shouldInline(program, type)
			);
		default:
			return false;
	}
}

/**
 * **Everything a service declares that its 3.0 document cannot publish, reported once each**,
 * whichever walk renders it or none: a `null` in a union, named or written where it is used, a bare
 * `null`, and a sealed model's record - see `unpublishable-null` and `unpublishable-record`.
 * The walks refuse each as they reach it; this is what makes sure every one is named, the way a
 * property's `T | null` is peeled off before any union is rendered.
 */
export function reportUnpublishable(program: Program, service: Namespace): void {
	if (!publishesOpenApi30(program)) return;
	const check = (type: Type): void => {
		const why = unpublishableNullWhy(program, type);
		if (why !== undefined) refuseUnpublishableNull(program, type, why);
	};
	navigateTypesInNamespace(
		service,
		{
			union: check,
			// A bare `null` is one type everywhere, so it is reported where it is used.
			modelProperty: (property) => {
				if (property.type.kind !== "Intrinsic") return;
				const why = unpublishableNullWhy(program, property.type);
				if (why !== undefined) refuseUnpublishableNull(program, property.type, why, property);
			},
			model: (model) => {
				const record = unpublishableRecordOf(program, model);
				if (record !== undefined) refuseUnpublishableRecord(program, model, record);
			},
		},
		{ skipSubNamespaces: isGlobalNamespace(program, service) },
	);
}

/** Refused where the 3.0 document cannot publish its `null` - see `unpublishable-null`. */
function refuseUnpublishableNull(
	program: Program,
	type: Type,
	why: string,
	at: Type = refusalTarget(type),
): string {
	const target = at;
	if (firstReportOf(program, "unpublishable-null", target)) {
		reportDiagnostic(program, {
			code: "unpublishable-null",
			target,
			format: { type: getTypeName(type), why },
		});
	}
	return UNREPRESENTABLE;
}

function unionToZod(program: Program, union: Union): string {
	const unpublishable = unpublishableNullWhy(program, union);
	if (unpublishable !== undefined) return refuseUnpublishableNull(program, union, unpublishable);
	/**
	 * A `@discriminated` union becomes `z.discriminatedUnion`, not `z.union`.
	 *
	 * Both accept the same values, but a plain union reports "no variant matched" and lists every
	 * failure, while a discriminated one reads the tag and reports the single rule that was actually
	 * broken. These unions carry cross-field rules that would otherwise hide in a hand-written
	 * predicate - publishing the rule and then reporting it unreadably would only move the problem.
	 */
	const [discriminated] = getDiscriminatedUnion(program, union);
	if (discriminated !== undefined) {
		const options = discriminated.options;
		if (discriminated.defaultVariant !== undefined) {
			// "Anything else" has no discriminator value to switch on. Refused by name rather than
			// silently dropped - no corpus scenario exercises it, so guessing would be untested code.
			return refuse(
				program,
				union,
				"a discriminated union with a default variant",
				"Remove the default variant, or declare it as an ordinary variant with its own discriminator value.",
			);
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
			const undeclared = [...discriminated.variants.values()]
				.map((variant) => ({
					variant,
					why: undeclaredVariantOf(program, variant, options.discriminatorPropertyName),
				}))
				.filter(({ why }) => why === "missing" || why === "open");
			const [first] = undeclared;
			if (first !== undefined) {
				reportDiagnostic(program, {
					code: "undeclared-discriminator",
					messageId: first.why === "open" ? "open" : "default",
					target: union,
					format: {
						name: union.name ?? "an anonymous union",
						property: options.discriminatorPropertyName,
						variant: (first.variant as { name?: string }).name ?? "one of its variants",
					},
				});
				return UNREPRESENTABLE;
			}
		}
		const dispatched = dispatchedVariantsOf(program, union);
		// A variant left out for a key its sealed base refuses is refused as itself, as anywhere else.
		for (const variant of discriminated.variants.values()) {
			if (variant.kind === "Model") reportSealedBaseExtended(program, variant);
		}
		const kept = dispatched
			.map(([name, variant]) => ({
				variant,
				member: discriminatedVariant(program, union, name, variant, options),
			}))
			.filter(({ member }) => !held.refused(member));
		const members = kept.map(({ member }) => member);
		// Every variant refused by a declaration above it: the document accepts no value either.
		if (members.length === 0) return UNREPRESENTABLE;
		const property = options.discriminatorPropertyName;
		/**
		 * **A discriminator a PATCH makes optional dispatches nothing**: `z.discriminatedUnion` reads
		 * one fixed value per member, and the document publishes `oneOf` - exactly one member - which
		 * with the tag absent is what `z.xor` checks. As a dispatch, `{ value: {...} }` was refused.
		 */
		if (dispatched.some(([, variant]) => optionalDiscriminator(program, union, variant, options))) {
			return members.length === 1 ? (members[0] as string) : `z.xor([${members.join(", ")}])`;
		}
		/**
		 * **A variant no dispatch can hold sits beside it**, as a nested base does beside a base's own
		 * dispatch: one with no envelope that is a `@discriminator` base itself, a `z.union` with no
		 * literal to read, and one annotated for its recursion. In the dispatch, every parse threw
		 * "Invalid discriminated union option". Each fixes a value of its own, so at most one matches.
		 */
		const beside = kept
			.filter(
				({ variant, member }) =>
					held.annotated(member) ||
					(options.envelope === "none" &&
						variant.kind === "Model" &&
						discriminatedBaseOf(program, variant) !== undefined),
			)
			.map(({ member }) => member);
		const dispatch = members.filter((member) => !beside.includes(member));
		if (beside.length === 0) {
			return `z.discriminatedUnion(${literal(property)}, [${members.join(", ")}])`;
		}
		const arms = [
			...(dispatch.length === 0
				? []
				: [`z.discriminatedUnion(${literal(property)}, [${dispatch.join(", ")}])`]),
			...beside,
		];
		return arms.length === 1 ? (arms[0] as string) : `z.xor([${arms.join(", ")}])`;
	}
	const variants = [...union.variants.values()].map((variant) => variant.type);
	const nulls = variants.filter(isNull).length;
	const real = variants.filter((type) => !isNull(type));
	const exclusive = isExclusive(program, union) || exclusiveSite === union;
	/**
	 * **Asked once the members are written**: writing one declares it, and a declaration openapi3
	 * publishes split is refused only as it is written. Asked first, `@oneOf { v0: float, v1: M10, v2:
	 * M11 }` held the `M10` refused while it was written, and the contract type, walked after every
	 * refusal, was `never` - `wire-contract.gen.ts` did not compile (`TS2344`).
	 */
	const written = ((): string => {
		// A raw `bytes` member of a multipart part's union is any value - see `withMultipartBinary`.
		const memberToZod = (type: Type): string =>
			multipartBinary && isRawBytes(program, type) ? "z.unknown()" : typeToZod(program, type);
		/**
		 * **A `@oneOf` refuses the `null` more than one of its members matches**: openapi3 publishes
		 * each `null` variant as a `{ type: "null" }` of its own, beside members that may admit it too -
		 * `unknown | null` is `oneOf [{}, null]`, which no `null` passes. Each is a `z.null()` member of
		 * the `z.xor`, which counts as the document does; `.nullable()` passed `null` before either.
		 */
		if (
			exclusive &&
			nulls > 0 &&
			(nulls > 1 || real.some((type) => admitsNullValue(program, type)))
		) {
			const members = [...literalGroupsOf(real, memberToZod), ...Array(nulls).fill("z.null()")];
			return `z.xor([${members.join(", ")}])`;
		}

		// `null | null` is `null`, as the document reads it - and `q: null` was never refused.
		if (real.length === 0) return "z.null()";

		const suffix = nulls > 0 ? ".nullable()" : "";
		if (real.every((type) => type.kind === "String")) {
			const literals = real.map((type) => literal((type as { value: string }).value));
			return `z.enum([${literals.join(", ")}])${suffix}`;
		}
		if (real.length === 1) return `${memberToZod(real[0] as Type)}${suffix}`;
		/**
		 * **Every literal of one JSON kind is one member of a `@oneOf`**, as openapi3 publishes it - one
		 * `enum` per kind: `1` repeated is matched once, where two `z.literal(1)` matched it twice.
		 */
		const members = exclusive ? literalGroupsOf(real, memberToZod) : real.map(memberToZod);
		if (members.length === 1) return `${members[0] as string}${suffix}`;
		return `${exclusive ? "z.xor" : "z.union"}([${members.join(", ")}])${suffix}`;
	})();
	return holdsRefusedMember(program, union, exclusive) ? UNREPRESENTABLE : written;
}

/** A union's members as Zod, its literals of each JSON kind as one member where the first one stands. */
function literalGroupsOf(types: readonly Type[], memberToZod: (type: Type) => string): string[] {
	const groups = new Map<string, (string | number | boolean)[]>();
	const members: (string | { readonly group: string })[] = [];
	for (const type of types) {
		const value = type.kind === "EnumMember" ? undefined : literalValueOf(type);
		if (value === undefined) {
			members.push(memberToZod(type));
			continue;
		}
		const kind = typeof value;
		const group = groups.get(kind);
		if (group === undefined) {
			groups.set(kind, [value]);
			members.push({ group: kind });
		} else if (!group.includes(value)) group.push(value);
	}
	return members.map((member) => {
		if (typeof member === "string") return member;
		const values = groups.get(member.group) ?? [];
		if (values.every((each) => typeof each === "string")) {
			return `z.enum([${values.map((each) => literal(each as string)).join(", ")}])`;
		}
		const literals = values.map((each) => `z.literal(${literal(each)})`);
		return literals.length === 1 ? (literals[0] as string) : `z.union([${literals.join(", ")}])`;
	});
}

/**
 * TypeSpec models arrays and dictionaries as a `Model` carrying an **indexer**.
 *
 * **Keyed on the indexer, not on the model's name.** This used to test `name === "Record"`, which
 * silently lost the indexer of any model *derived* from one - `model Settings is
 * Record<string | float64 | boolean>` emitted `z.object({})`, a schema that accepts an object and
 * then strips every key in it. That is silent data loss on a write, and nothing downstream could
 * tell "the caller sent nothing" from "the validator threw it away". A named model is still declared
 * and referenced normally; only its *body* comes from the indexer.
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
 * It was invisible because the differential skipped every schema carrying an `allOf`, so those
 * components were not divergent, they were never compared.
 *
 * Flattened rather than composed. `z.object(...).extend(...)` would mirror the document's structure
 * more literally and cannot be used here: `.extend()` reads `shape` eagerly, so a base whose property
 * refers back to the derived model - `type/model/inheritance/recursive`, the exact case - would throw
 * during module initialisation. Flattening asks nothing of the base but its properties.
 */
export function inheritedAndOwnProperties(program: Program, model: Model): ModelProperty[] {
	return flattenedPropertiesOf(program, model).map((entry) => entry.property);
}

/**
 * A property of a model as the document publishes the model: the most derived declaration of a wire
 * key, and the declarations of the same key further up the chain, nearest first.
 *
 * **Keyed on the WIRE name, because that is what the document keys a schema's properties on.** A
 * subtype is published as `allOf` its base, so every declaration of a key along the chain still
 * applies to the value. Keyed on the TypeSpec name, `@encodedName("application/json", "k") kind` on a
 * base was REPLACED by a subtype's `kind`, so the subtype lost the `k` its base requires; and a base's
 * `kind` renamed to `type` beside a subtype's own `type` was written as two `type` keys, which does not
 * compile.
 */
export interface FlattenedProperty {
	readonly property: ModelProperty;
	readonly overridden: readonly ModelProperty[];
}

export function flattenedPropertiesOf(
	program: Program,
	model: Model,
): readonly FlattenedProperty[] {
	const chain: Model[] = [];
	for (let link: Model | undefined = model; link !== undefined; link = link.baseModel) {
		chain.unshift(link);
	}
	// Base first, so a derived model REDECLARING a key overrides rather than duplicates it.
	const byKey = new Map<string, { model: Model; property: ModelProperty }[]>();
	for (const link of chain) {
		for (const property of link.properties.values()) {
			const key = rawPropertyKey(program, property);
			const declarations = byKey.get(key) ?? [];
			// Two keys of one name in one model: openapi3 writes the later over the earlier.
			if (declarations.at(-1)?.model === link) declarations.pop();
			declarations.push({ model: link, property });
			byKey.set(key, declarations);
		}
	}
	return [...byKey.values()].map((declarations) => ({
		property: (declarations.at(-1) as { property: ModelProperty }).property,
		overridden: declarations
			.slice(0, -1)
			.reverse()
			.map((declaration) => declaration.property),
	}));
}

/**
 * The keys a model publishes at the current position, each with every declaration of it the
 * document holds the value to - its most derived published declaration first.
 *
 * **A declaration counts where openapi3 publishes it, and only there.** Each model in the chain is
 * published as `allOf` the one above, and each judges its own properties at the position: a
 * `@header` or a create-only property above a response is in no schema the response is held to, so
 * its `@maxLength` bounds nothing there; a `never` or an invisible redeclaration drops out of its own
 * model's schema and leaves the key to the ones above it. Judged on the most derived declaration
 * alone, the first was enforced where the document does not, and the second dropped a key the base
 * still requires.
 *
 * **HTTP metadata is not payload.** A `@header` or `@statusCode` property describes the envelope, so
 * it never appears in the body: RFC 9457 puts `@header("content-type") contentType:
 * "application/problem+json"` on the problem model, the document described a body without it, and
 * this emitter required `contentType` as a member. **A `never` property is dropped, as the document
 * drops it**: `model N { value: never; other: string }` is published as `{other}`, and a validator
 * keeping `value: z.never()` refused `{"other": "x"}`, the exact body the document describes.
 */
export function publishedPropertiesOf(
	program: Program,
	model: Model,
): readonly FlattenedProperty[] {
	return declarationsWhere(program, model, (declaration) =>
		atPublication(program, declaration, () => isPayloadProperty(program, declaration)),
	);
}

/**
 * **The keys a model's `required` is read from: each declaration at the visibility its model is
 * rendered at**, where openapi3 reduces the reference - see `contentMisreadingsOf`. Wider than
 * {@link publishedPropertiesOf} where a read-only declaration drops out of the properties openapi3
 * reads at a create body's visibility, and stays required at `Read`.
 */
function renderedPropertiesOf(program: Program, model: Model): readonly FlattenedProperty[] {
	return declarationsWhere(program, model, (declaration) =>
		atDeclaration(program, declaration, () => isPayloadProperty(program, declaration)),
	);
}

function declarationsWhere(
	program: Program,
	model: Model,
	present: (declaration: ModelProperty) => boolean,
): readonly FlattenedProperty[] {
	const published: FlattenedProperty[] = [];
	for (const entry of flattenedPropertiesOf(program, model)) {
		const [property, ...overridden] = [entry.property, ...entry.overridden].filter(
			(declaration) => present(declaration) && !isNeverType(declaration.type),
		);
		if (property !== undefined) published.push({ property, overridden });
	}
	return published;
}

/**
 * **A declaration is in its model's schema where openapi3 reads that model's properties: at the
 * visibility the reference it writes the model from arrived at** - see `readVisibilityOf` - not the
 * one it reduces that to. `X { @visibility(Read) @maxLength(2) id: string; ...Record<string> }`
 * first sent in a create body is published without `id` in its properties, so its indexer holds the
 * `id` its `required` names; validated by the read-only declaration, `"abcdef"` was refused. Likewise
 * a base's `id`, or the `string` openapi3 adds for a discriminator, holds a key whose read-only
 * declaration drops out.
 */
function atPublication<T>(program: Program, property: ModelProperty, run: () => T): T {
	const model = property.model;
	if (model === undefined) return run();
	// Of several views under one name, the one the document keeps - see `keptVisibilityOf`.
	const rendered = keptVisibilityOf(model, renderedVisibilityOf(program, model, visibility));
	return withVisibility(readVisibilityOf(program, model, rendered, metadataIgnored), run);
}

/**
 * The discriminators a model is published under: its own and every one up its chain, by wire name.
 * openapi3 lists each in its base's `required`, and the base applies through `allOf`.
 */
export function discriminatorsOf(program: Program, model: Model): readonly string[] {
	const names: string[] = [];
	for (let link: Model | undefined = model; link !== undefined; link = link.baseModel) {
		const discriminator = getDiscriminator(program, link);
		if (discriminator !== undefined && !names.includes(discriminator.propertyName)) {
			names.push(discriminator.propertyName);
		}
	}
	return names;
}

/**
 * **What the document asserts of a property at its position in a model, beyond its own declaration.**
 *
 * openapi3 publishes a subtype as `allOf` its base, so every declaration of a key along the chain
 * still applies. Flattened to the subtype's declaration alone, `Pet { @maxLength(3) name: string }`
 * let `Dog`'s own `name: string` be `"rexie"`, which the document refuses - and, under a discriminated
 * base, so did the base, whose dispatch accepted it.
 *
 * **Where the overriding value narrows each declaration above it, the rest is their keywords**:
 *
 * - `constrainedBy`: the ancestors' own constraints, and their declared scalars', applied to the
 *   value for its own JSON type; a literal is checked against them statically.
 * - `never`: no value is both - another JSON type, or a literal the ancestor refuses.
 * - `nullOnly`: the override's literals are all refused, and both sides admit `null`.
 * - `nonNull`: the override admits `null` and a declaration above it does not.
 * - `stringOnly`: openapi3 adds the discriminator as a `string` to the model declaring
 *   `@discriminator` where that model's OWN properties lack it, whatever a model above it declares.
 *
 * **Where it does not, the declarations are merged into one schema** - `value`, see
 * {@link mergeParts}: two unrelated models key by key, two lists by element, a union member by
 * member. Zod's `.and()` is never put between two objects: it pools the keys one sealed side refuses,
 * throws on two defaults, and is no option a dispatch can read.
 *
 * `required` holds where the property is a discriminator, which openapi3 adds to the base's
 * `required` however it is declared, or where any declaration above requires it.
 */
export interface PropertyPosition {
	readonly constrainedBy: readonly Keyworded[];
	readonly required: boolean;
	readonly stringOnly: boolean;
	readonly never: boolean;
	readonly nullOnly: boolean;
	readonly nonNull: boolean;
	/** The value as one schema, where the declarations above are merged with it rather than implied. */
	readonly value: Merged | undefined;
	/** The declarations above, each published at this position. */
	readonly ancestors: readonly ModelProperty[];
	/**
	 * **The visibility the most derived declaration's model is published at**, where a merge holds
	 * declarations published apart - see `mergeShapes`. Its optionality is read there: `M6 { b }`
	 * merged at a PATCH beside an `S8` published at `Read` was `b` required, where the document's
	 * `M6` leaves it optional.
	 */
	readonly at?: Visibility;
	/** A merge no one schema states - see `unrepresentable-override`. */
	readonly refused:
		| { readonly ancestor: ModelProperty; readonly why: string; readonly recursive: boolean }
		| undefined;
}

export const OWN_POSITION: PropertyPosition = {
	constrainedBy: [],
	required: false,
	stringOnly: false,
	never: false,
	nullOnly: false,
	nonNull: false,
	value: undefined,
	ancestors: [],
	refused: undefined,
};

export function positionOf(
	program: Program,
	model: Model,
	entry: FlattenedProperty,
): PropertyPosition {
	const key = rawPropertyKey(program, entry.property);
	return positionOfDeclarations(program, entry.property, entry.overridden, {
		required: discriminatorsOf(program, model).includes(key),
		injected: injectedDiscriminatorsOf(program, model).includes(key),
		beside: [],
	});
}

/**
 * The position of `own` beneath `ancestors`, the declarations of one key the document holds its
 * value to, plus `beside`: what no declaration states - a typed indexer of a model merged with it, an
 * envelope's members.
 */
function positionOfDeclarations(
	program: Program,
	own: ModelProperty,
	ancestors: readonly ModelProperty[],
	options: {
		readonly required: boolean;
		readonly injected: boolean;
		readonly beside: readonly Part[];
		/**
		 * The visibility each declaration's own model is published at, where merged from several: one
		 * per declaration, `own` first. A list, not a map - one model merged at two visibilities, a
		 * list literal's element beside a named list's, holds the same declaration twice.
		 */
		readonly at?: readonly Visibility[];
	},
): PropertyPosition {
	const position: PropertyPosition = {
		...OWN_POSITION,
		ancestors,
		required: options.required || ancestors.some((ancestor) => isRequiredAt(program, ancestor)),
		...(options.at?.[0] === undefined ? {} : { at: options.at[0] }),
	};
	const beside = options.beside.filter(
		(part) => !isTypelessPart(program, part) || part.keywords.length > 0,
	);
	const atOf = (index: number): Visibility | undefined => options.at?.[index];
	const ownAt = atOf(0) ?? visibility;
	/**
	 * **A key one declaration states is still published at that declaration's visibility**: `M5`'s
	 * `e: M6`, merged at `Read` beside `M4Update`, is `M6`, and rendered at the merge's own `Update`
	 * it was `M6Update`, which accepts the `{}` that `M6` refuses.
	 */
	const apart =
		ownAt !== visibility &&
		renderedVisibilityOf(program, nullableInnerOf(own.type) ?? own.type, ownAt) !==
			renderedVisibilityOf(program, nullableInnerOf(own.type) ?? own.type, visibility);
	if (ancestors.length === 0 && !options.injected && beside.length === 0 && !apart) {
		return position;
	}
	// Reported and refused by its own walk - see `unsatisfiable-encoding`.
	if (encodedValueOf(program, own).kind === "unsatisfiable") return position;
	const constrainedBy: Keyworded[] = [];
	let never = false;
	let nullOnly = false;
	let nonNull = false;
	let merge = beside.length > 0 || apart;
	for (const [index, ancestor] of ancestors.entries()) {
		/**
		 * **A declaration published at another visibility is merged, unless its type is one schema at
		 * both**: `In` in a list literal's element is published at `Update | Item` and in a named list's
		 * at `Update`, and taken as narrowed by itself it was `InUpdate` alone, `x` optional where the
		 * element requires it.
		 */
		const ancestorAt = atOf(index + 1) ?? visibility;
		const declared = nullableInnerOf(ancestor.type) ?? ancestor.type;
		if (
			ancestorAt !== ownAt &&
			renderedVisibilityOf(program, declared, ancestorAt) !==
				renderedVisibilityOf(program, declared, ownAt)
		) {
			merge = true;
			continue;
		}
		if (
			elementsPublishedApart(
				program,
				nullableInnerOf(own.type) ?? own.type,
				ownAt,
				declared,
				ancestorAt,
			)
		) {
			merge = true;
			continue;
		}
		const verdict = overrideVerdictOf(program, own, ancestor);
		if (verdict.kind === "never") never = true;
		else if (verdict.kind === "null") nullOnly = true;
		else if (verdict.kind === "merge") merge = true;
		else {
			constrainedBy.push(...verdict.constrainedBy);
			nonNull ||= verdict.nonNull;
		}
	}
	if (never) return { ...position, never: true };
	if (merge) {
		const withAt = (declaration: ModelProperty, index: number): Part | undefined => {
			const part = partOfProperty(program, declaration);
			const at = atOf(index);
			return part === undefined || at === undefined ? part : { ...part, at };
		};
		const value = mergeParts(program, [
			...[own, ...ancestors].map(withAt),
			...(options.injected ? [stringPart(program)] : []),
			...beside,
		]);
		const refusal = refusalIn(value);
		return {
			...position,
			value,
			never: value.kind === "never",
			refused:
				refusal === undefined
					? undefined
					: {
							ancestor: ancestors[0] ?? own,
							why: refusal.why,
							recursive: refusal.recursive === true,
						},
		};
	}
	let stringOnly = false;
	if (options.injected) {
		const types = valueJsonTypesOf(program, own);
		if (types === undefined) stringOnly = true;
		else if (!types.has("string")) never = true;
		else stringOnly = [...types].some((type) => type !== "string");
		nonNull ||= admitsNull(program, own);
	}
	return { ...position, constrainedBy, stringOnly, never, nullOnly, nonNull };
}

/** Whether a declaration requires its key at the current position. */
function isRequiredAt(program: Program, property: ModelProperty): boolean {
	return !(
		property.optional || atDeclaration(program, property, () => isOptionalAt(program, property))
	);
}

/**
 * **A declaration is judged at the visibility its own model is rendered at**, as openapi3 renders
 * each model of a chain: a subtype's create body is `allOf` its base, and a base with nothing
 * create-specific is the canonical schema - its read-only `id` shared in, `readOnly` and required.
 * Judged at the subtype's visibility, the base's `id` dropped out of the create body the document
 * requires it in. See `renderedVisibilityOf`.
 */
/** At the visibility a merged member's declaration is published at, where it is not the merge's. */
export function atPosition<T>(position: PropertyPosition, run: () => T): T {
	return position.at === undefined ? run() : withVisibility(position.at, run);
}

export function atDeclaration<T>(program: Program, property: ModelProperty, run: () => T): T {
	const model = property.model;
	// Of several views under one name, the one the document keeps - see `keptVisibilityOf`.
	return model === undefined
		? run()
		: withVisibility(
				keptVisibilityOf(model, renderedVisibilityOf(program, model, visibility)),
				run,
			);
}

/**
 * **A property's type is referred to at the visibility openapi3 reads its declaration's properties
 * at** - see `readVisibilityOf` - where the declaration is rendered at the current one. Its
 * optionality and its position stay where the model is published; only what the type is named, a
 * list or a union instance openapi3 does not reduce, can differ.
 */
export function atReading<T>(program: Program, property: ModelProperty, run: () => T): T {
	const model = property.model;
	if (model === undefined) return run();
	const read = readVisibilityOf(program, model, visibility, metadataIgnored);
	return read === visibility ? run() : withVisibility(read, run);
}

/** Whether a declaration's value may be `null`, as the document publishes it. */
function admitsNull(program: Program, property: ModelProperty): boolean {
	const encoding = encodedValueOf(program, property);
	if (encoding.kind === "replaced" || encoding.kind === "both") return encoding.nullable;
	if (encoding.kind === "unsatisfiable") return false;
	return admitsNullValue(program, property.type, exclusiveAt(program, property));
}

/** Whether a property's value is a `@oneOf`: its union's own, or its own on its inline union. */
function exclusiveAt(program: Program, property: ModelProperty): boolean {
	const type = property.type;
	return (
		isExclusive(program, type) ||
		(isExclusive(program, property) && type.kind === "Union" && type.name === undefined)
	);
}

/**
 * **`T | null` read as `T` beside its `null`** - unless it is a `@oneOf` whose `T` takes `null`
 * too, which then refuses it: `@oneOf unknown | null` is `oneOf [{}, null]`, and no `null` passes.
 */
function peeledNullOf(program: Program, property: ModelProperty): Type | undefined {
	const inner = nullableInnerOf(property.type);
	return inner !== undefined && exclusiveAt(program, property) && admitsNullValue(program, inner)
		? undefined
		: inner;
}

type OverrideVerdict =
	| {
			readonly kind: "implied";
			readonly constrainedBy: readonly Keyworded[];
			readonly nonNull: boolean;
	  }
	| { readonly kind: "never" }
	| { readonly kind: "null" }
	| { readonly kind: "merge" };

/**
 * **Whether two lists' elements are published at visibilities their types differ at**: a list
 * literal's element at `Item`, a named list's at the list's own. Under a PATCH, `u: El[]` over
 * `u: Els` holds each element to `El` and to `ElUpdate`, and taken as narrowed by the element type
 * alone it was `El`, sealed against the `c` that `InnerUpdate` refuses.
 */
function elementsPublishedApart(
	program: Program,
	own: Type,
	ownAt: Visibility,
	ancestor: Type,
	ancestorAt: Visibility,
): boolean {
	const elementOf = (list: Type, at: Visibility) => {
		if (list.kind !== "Model" || effectiveIndexer(list)?.key.name !== "integer") return undefined;
		const element = (effectiveIndexer(list) as { value: Type }).value;
		return { element, at: isArrayLiteral(program, list) ? at | Visibility.Item : at };
	};
	const one = elementOf(own, ownAt);
	const other = elementOf(ancestor, ancestorAt);
	if (one === undefined || other === undefined || one.at === other.at) return false;
	return [one.element, other.element].some(
		(element) =>
			renderedVisibilityOf(program, element, one.at) !==
			renderedVisibilityOf(program, element, other.at),
	);
}

/** How one declaration above an overriding one bears on its value - see {@link PropertyPosition}. */
function overrideVerdictOf(
	program: Program,
	own: ModelProperty,
	ancestor: ModelProperty,
): OverrideVerdict {
	if (disjoint(program, own, ancestor)) return { kind: "never" };
	const ancestorEncoding = encodedValueOf(program, ancestor);
	if (ancestorEncoding.kind === "unsatisfiable") return { kind: "never" };
	const ownEncoding = encodedValueOf(program, own);
	// An encoding that keeps its declared type beside another holds the value to both, whole.
	if (ownEncoding.kind === "both" || ancestorEncoding.kind === "both") return { kind: "merge" };
	/**
	 * `null` is a value of its own: no keyword applies to it, and it is valid on both sides only
	 * where both admit it. An override of `null` alone narrows an ancestor admitting it.
	 */
	const ownNull = admitsNull(program, own);
	const ancestorNull = admitsNull(program, ancestor);
	const nonNull = ownNull && !ancestorNull;
	const implied = { kind: "implied", constrainedBy: [], nonNull } as const;
	if (isNull(own.type)) return ancestorNull ? implied : { kind: "never" };
	/**
	 * A literal is judged now, value by value: against the ancestor's constraints and its declared
	 * type, as JSON Schema would. Every value admitted leaves nothing to apply; none admitted leaves
	 * `null` where both sides allow it, and no value otherwise. Values some of which the ancestor's
	 * own keywords refuse are narrowed member by member - see `constrainedMembersOf` - and values its
	 * TYPE refuses are merged out.
	 */
	const literals = literalValuesOfType(own.type);
	if (literals !== undefined) {
		const ancestorType =
			ancestorEncoding.kind === "replaced" ? ancestorEncoding.scalar : ancestor.type;
		const byType = literals.filter((value) => admitsValue(program, ancestorType, value));
		const admitted = byType.filter(
			(value) => brokenConstraintOf(program, ancestor, value) === undefined,
		);
		if (admitted.length === literals.length) return implied;
		if (admitted.length === 0) {
			return ownNull && ancestorNull ? { kind: "null" } : { kind: "never" };
		}
		if (byType.length === literals.length) {
			return { kind: "implied", constrainedBy: [ancestor], nonNull };
		}
		return { kind: "merge" };
	}
	const ownType =
		ownEncoding.kind === "replaced" ? ownEncoding.scalar : (peeledNullOf(program, own) ?? own.type);
	const ancestorType =
		ancestorEncoding.kind === "replaced"
			? ancestorEncoding.scalar
			: (peeledNullOf(program, ancestor) ?? ancestor.type);
	const narrowed = narrowsTo(program, ownType, ancestorType);
	if (narrowed === undefined) return { kind: "merge" };
	return {
		kind: "implied",
		constrainedBy: [...(hasConstraints(program, ancestor) ? [ancestor] : []), ...narrowed],
		nonNull,
	};
}

/**
 * **Whether every value of `own` is a value of `ancestor`**, and the declared scalars whose rules
 * are left to apply - or `undefined` where neither one validator can say. A scalar narrows by
 * TypeSpec's own assignability, plus the rules of any declared scalar above it; a model only by
 * extending; a list by its element; a union where some member does.
 */
function narrowsTo(program: Program, own: Type, ancestor: Type): readonly Keyworded[] | undefined {
	if (own === ancestor) return [];
	if (own.kind === "UnionVariant") return narrowsTo(program, own.type, ancestor);
	if (ancestor.kind === "UnionVariant") return narrowsTo(program, own, ancestor.type);
	// A union with an envelope is published as its wrappers, which no variant type is.
	if (isEnveloped(program, own) || isEnveloped(program, ancestor)) return undefined;
	// A literal narrows whatever admits its value, read statically.
	const value = literalValueOf(own);
	if (value !== undefined) return admitsValue(program, ancestor, value) ? [] : undefined;
	if (own.kind === "Union") {
		const scalars: Keyworded[] = [];
		for (const member of membersOf(own)) {
			// A `null` the ancestor refuses - a list's element, a record's value - is merged out.
			if (isNull(member)) {
				if (hasNull(ancestor) || isTypelessMember(program, ancestor)) continue;
				return undefined;
			}
			const each = narrowsTo(program, member, ancestor);
			if (each === undefined) return undefined;
			scalars.push(...each);
		}
		return scalars;
	}
	switch (ancestor.kind) {
		case "Scalar": {
			if (own.kind !== "Scalar") return undefined;
			if (!isAssignable(program, own, ancestor) && !checksNoMoreThan(program, own, ancestor)) {
				return undefined;
			}
			return program.checker.isStdType(ancestor) ? [] : [ancestor];
		}
		case "Tuple": {
			if (own.kind !== "Tuple" || own.values.length !== ancestor.values.length) return undefined;
			const each = own.values.map((value, index) =>
				narrowsTo(program, value, ancestor.values[index] as Type),
			);
			return each.every((value) => value !== undefined && value.length === 0) ? [] : undefined;
		}
		case "Model": {
			// A record of what narrows the ancestor's record's values, with no rules of its own to add.
			if (
				ancestor.indexer?.key.name === "string" &&
				ancestor.properties.size === 0 &&
				own.kind === "Model" &&
				own.indexer?.key.name === "string" &&
				own.properties.size === 0
			) {
				const value = narrowsTo(program, own.indexer.value, ancestor.indexer.value);
				return value !== undefined && value.length === 0 ? [] : undefined;
			}
			const ancestorElement =
				ancestor.indexer?.key.name === "integer" ? ancestor.indexer.value : undefined;
			if (ancestorElement !== undefined) {
				const ownElement =
					own.kind === "Model" && own.indexer?.key.name === "integer"
						? own.indexer.value
						: undefined;
				if (ownElement === undefined) return undefined;
				// An element's own rules cannot be added to a list's: only a list of what it already is.
				const element = narrowsTo(program, ownElement, ancestorElement);
				if (element === undefined || element.length > 0) return undefined;
				// A named list model's own `@minItems` and `@maxItems` still hold - `b: Duo` under `Pair`.
				return hasConstraints(program, ancestor) ? [ancestor] : [];
			}
			for (let link = own.kind === "Model" ? own : undefined; link; link = link.baseModel) {
				if (link === ancestor) return [];
			}
			return undefined;
		}
		/**
		 * **Into a union, only where the member it narrows says everything left to apply.** A member it
		 * narrows wholly - itself, or a standard scalar - leaves nothing; ONE member it narrows with
		 * rules of its own leaves those. Two such members are two alternatives - `Digits2` under
		 * `Lower | Digits` is a `Digits2` that is a `Lower` OR a `Digits` - which no list of rules says,
		 * so the declarations are merged member by member instead. Taking the first, `Digits2` was held
		 * to `Lower`'s pattern and `Digits`' at once, and accepted nothing.
		 */
		case "Union":
		case "Enum": {
			// Into `@oneOf`, a value of the override may match two members, which the document refuses.
			if (isExclusive(program, ancestor)) return undefined;
			/**
			 * **Into a `@discriminated` union - a `oneOf` too - only where its discriminator tells every
			 * variant apart.** Where one may leave it out - `kind?`, or any under a PATCH - `{}` is an `NA`
			 * and an `NB`, which the document refuses: narrowed to `NA` under `DN`, it was accepted.
			 */
			if (ancestor.kind === "Union") {
				const [discriminated] = getDiscriminatedUnion(program, ancestor);
				if (
					discriminated !== undefined &&
					[...discriminated.variants.values()].some((variant) =>
						optionalDiscriminator(program, ancestor, variant, discriminated.options),
					)
				) {
					return undefined;
				}
			}
			const members = alikeMembersOf(program, ancestor);
			const narrowed = members.map((member) => narrowsTo(program, own, member));
			if (narrowed.some((each) => each !== undefined && each.length === 0)) return [];
			const narrowing = narrowed.flatMap((each, index) => (each === undefined ? [] : [index]));
			if (narrowing.length !== 1) return undefined;
			const [index] = narrowing as [number];
			/**
			 * The one member's rules say everything only where no other member takes a value of it too:
			 * `string` under `"green" | Short` is `"green"` OR a `Short`, and held to `Short`'s
			 * `@maxLength` alone it refused the `"green"` both declarations accept.
			 */
			return members.some((member, other) => other !== index && overlaps(program, own, member))
				? undefined
				: narrowed[index];
		}
		case "Intrinsic":
			return ancestor.name === "unknown" ? [] : undefined;
		default:
			return undefined;
	}
}

/**
 * Whether a value of `own` may be a value of `member` too, as far as their JSON types and a literal
 * tell - taken as so where either has no type to tell by.
 */
function overlaps(program: Program, own: Type, member: Type): boolean {
	const value = literalValueOf(member);
	if (value !== undefined) return admitsValue(program, own, value);
	const ownTypes = jsonTypesOf(program, own);
	const memberTypes = jsonTypesOf(program, member);
	if (ownTypes === undefined || memberTypes === undefined) return true;
	const numeric = (type: JsonType): boolean =>
		type === "integer" || type === "number" || type === "fraction";
	return [...ownTypes].some((one) =>
		[...memberTypes].some((other) => one === other || (numeric(one) && numeric(other))),
	);
}

/**
 * **Whether a scalar's own check says everything another's does**, where TypeSpec's assignability
 * does not: `int32` under `float`, whose schema is only `type: number`, and `offsetDateTime` under
 * `utcDateTime`, which are checked alike. The other's own keywords are still applied, as the rules
 * of a declared scalar above it.
 */
function checksNoMoreThan(program: Program, own: Scalar, ancestor: Scalar): boolean {
	if (scalarEncodingOf(program, own) !== undefined) return false;
	if (scalarEncodingOf(program, ancestor) !== undefined) return false;
	const ownBase = standardBaseOf(program, own);
	const ancestorBase = standardBaseOf(program, ancestor);
	if (ownBase === undefined || ancestorBase === undefined) return false;
	const ownCheck = SCALARS[ownBase.name];
	const ancestorCheck = SCALARS[ancestorBase.name];
	if (ownCheck === undefined || ancestorCheck === undefined) return false;
	if (ownCheck === ancestorCheck) return true;
	const json = jsonTypeOfScalar(program, ancestorBase);
	return (
		json !== undefined && ancestorCheck === BARE_CHECKS[json] && isWithin(program, ownBase, json)
	);
}

/** The schema that checks a JSON type and nothing more. */
const BARE_CHECKS: Partial<Record<JsonType, string>> = {
	string: "z.string()",
	number: "z.number()",
	boolean: "z.boolean()",
};

/** The standard scalar a scalar is built on. */
function standardBaseOf(program: Program, scalar: Scalar): Scalar | undefined {
	for (let link: Scalar | undefined = scalar; link !== undefined; link = link.baseScalar) {
		if (program.checker.isStdType(link)) return link;
	}
	return undefined;
}

/** A `@discriminated` union with an envelope, whose members the document publishes as wrappers. */
function isEnveloped(program: Program, type: Type): boolean {
	if (type.kind !== "Union") return false;
	const [discriminated] = getDiscriminatedUnion(program, type);
	return discriminated !== undefined && discriminated.options.envelope !== "none";
}

/**
 * **Whether a union reaches itself through union members alone**: `union string { int32, string }`
 * in a namespace, where the member `string` names the union and not the scalar, or `A { int32, B }`
 * beside `B { string, A }`. No property or list element stands between the union and its own
 * reference, so the schema openapi3 publishes, `anyOf: [int32, { $ref: string }]`, refers to itself
 * with no value passed through on the way, and JSON Schema leaves that undefined - measured, Ajv
 * overflows its stack on `5`, `"abc"` and `null` alike. TypeScript refuses the alias it would be,
 * and the walks here that flatten a union recursed until the compiler reported "Emitter crashed!
 * This is a bug." A union with an envelope wraps each member in an object, which a value does pass
 * through, so the walk stops there.
 */
export function reachesItselfThroughUnions(program: Program, union: Union): boolean {
	const seen = new Set<Union>();
	const visit = (each: Union): boolean => {
		if (isEnveloped(program, each) || seen.has(each)) return false;
		seen.add(each);
		return [...each.variants.values()].some(({ type }) => {
			let member: Type = type;
			while (member.kind === "UnionVariant") member = member.type;
			return member === union || (member.kind === "Union" && visit(member));
		});
	};
	return visit(union);
}

/** Refuse a union that reaches itself through union members alone - see `reachesItselfThroughUnions`. */
export function refuseSelfReachingUnion(program: Program, union: Union): void {
	refuse(
		program,
		union,
		`its members reach '${getTypeName(union)}' again through unions alone, so the schema '@typespec/openapi3' publishes for it refers to itself with no value passed through on the way, which JSON Schema leaves undefined`,
		"If a member is meant to name another type, qualify it, as 'TypeSpec.string' names the scalar; if the recursion is meant, hold it in a model property or a list.",
	);
}

/** TypeSpec's own assignability, which an override is checked against and a rename is not. */
export function isAssignable(program: Program, source: Type, target: Type): boolean {
	return $(program).type.isAssignableTo(source, target);
}

function isNull(type: Type): boolean {
	return type.kind === "Intrinsic" && type.name === "null";
}

/** Whether a type admits `null`: it is `null`, or a union with `null` among its members. */
function hasNull(type: Type): boolean {
	return membersOf(type).some(isNull);
}

/** The fixed values of a type that is literals and nothing else, `null` aside; else `undefined`. */
function literalValuesOfType(type: Type): readonly (string | number | boolean)[] | undefined {
	const members = membersOf(type).filter(
		(member) => !(member.kind === "Intrinsic" && member.name === "null"),
	);
	const values = members.map(literalValueOf);
	return values.length > 0 && values.every((value) => value !== undefined)
		? (values as (string | number | boolean)[])
		: undefined;
}

/**
 * Whether a declared type admits a literal value.
 *
 * **A scalar admits what the check it emits admits** - see `scalarAccepts` - not every value of its
 * JSON type: `"red"` is a string and no `utcDateTime`. Read by type alone, `@oneOf { Color, string }`
 * merged with `k: utcDateTime` kept `"red"` and `"green"` as members of their own, and a value the
 * document finds in two members was accepted as one.
 */
function admitsValue(program: Program, type: Type, value: string | number | boolean): boolean {
	switch (type.kind) {
		case "UnionVariant":
			return admitsValue(program, type.type, value);
		case "Scalar": {
			const json = jsonTypeOfScalar(program, type);
			const kind =
				typeof value === "number"
					? Number.isInteger(value)
						? "integer"
						: "fraction"
					: typeof value;
			const fits =
				json === undefined ||
				json === kind ||
				(json === "number" && (kind === "integer" || kind === "fraction"));
			return (
				fits &&
				brokenConstraintOf(program, type, value) === undefined &&
				scalarAccepts(program, type, value) !== false
			);
		}
		case "String":
		case "Number":
		case "Boolean":
			return type.value === value;
		case "EnumMember":
			return (type.value ?? type.name) === value;
		case "Enum":
			return membersOf(type).some((member) => admitsValue(program, member, value));
		case "Union": {
			// Under `@oneOf`, a value two members admit is no value of the union.
			const admitting = alikeMembersOf(program, type).filter((member) =>
				admitsValue(program, member, value),
			);
			return isExclusive(program, type) ? admitting.length === 1 : admitting.length > 0;
		}
		case "Intrinsic":
			return type.name === "unknown";
		default:
			return false;
	}
}

/** Whether two declarations of one key share no JSON type, so no value is both. */
function disjoint(program: Program, one: ModelProperty, other: ModelProperty): boolean {
	const a = valueJsonTypesOf(program, one);
	const b = valueJsonTypesOf(program, other);
	if (a === undefined || b === undefined) return false;
	const numeric = (type: JsonType): boolean =>
		type === "integer" || type === "number" || type === "fraction";
	return ![...a].some((x) => [...b].some((y) => x === y || (numeric(x) && numeric(y))));
}

/** The JSON types a property's value is published as, `@encode` included; `undefined` for any. */
function valueJsonTypesOf(
	program: Program,
	property: ModelProperty,
): ReadonlySet<JsonType> | undefined {
	const encoding = encodedValueOf(program, property);
	if (encoding.kind === "replaced" || encoding.kind === "both") {
		const json = jsonTypeOfScalar(program, encoding.scalar);
		if (json === undefined) return undefined;
		return new Set<JsonType>(encoding.nullable ? [json, "null"] : [json]);
	}
	return jsonTypesOf(program, property.type);
}

/**
 * The discriminators openapi3 adds to a model as a required `string`: each `@discriminator` in the
 * chain whose model's OWN payload properties lack it.
 */
function injectedDiscriminatorsOf(program: Program, model: Model): readonly string[] {
	const names: string[] = [];
	for (let link: Model | undefined = model; link !== undefined; link = link.baseModel) {
		const discriminator = getDiscriminator(program, link);
		if (discriminator === undefined) continue;
		// Read where openapi3 reads the model's properties: a read-only `kind` sent in a create body is not.
		const declared = [...link.properties.values()].some(
			(property) =>
				atPublication(program, property, () => isPayloadProperty(program, property)) &&
				!isNeverType(property.type) &&
				rawPropertyKey(program, property) === discriminator.propertyName,
		);
		if (!declared) names.push(discriminator.propertyName);
	}
	return names;
}

/**
 * A declaration whose keywords - `@minLength`, `@minItems` and the like - apply to a value beside its
 * type: a property, a declared scalar above it, a model.
 */
export type Keyworded = ModelProperty | Scalar | Model;

/**
 * The wrapper openapi3 synthesises for one variant of a `@discriminated` union with an envelope -
 * `{kind: "cat", value: Cat}` - which no TypeSpec type stands for. A member of a merge like any other.
 */
interface Envelope {
	readonly kind: "Envelope";
	readonly union: Union;
	readonly name: string;
	readonly variant: Type;
	readonly discriminator: string;
	readonly property: string;
}

type Member = Type | Envelope;

/** One schema of the `allOf` a value is held to - see {@link mergeParts}. */
interface Part {
	/** What the value may be, `null` aside: one member, or each member of a union. */
	readonly members: readonly Member[];
	readonly nullable: boolean;
	readonly keywords: readonly Keyworded[];
	/** The declared type, where the part is one - rendered by reference where it narrows the rest. */
	readonly type?: Type;
	/** A declaration only valid whole: an encoding that keeps its declared type beside another. */
	readonly whole?: ModelProperty;
	/** Why no one schema states the part - a `@discriminated` union with a default variant. */
	readonly refused?: string;
	/** Its members are a `@oneOf` union's: exactly one may accept a value. */
	readonly exclusive?: boolean;
	/**
	 * **The visibility its value is published at, where that is not the merge's own** - each
	 * declaration's, as openapi3 publishes each: a list literal's element at `Item`, a named list's
	 * at the list's own visibility, a record's value at the record's. Merged at one visibility, a
	 * PATCH made every element of a list literal optional beside a named list, and a record's values
	 * optional where the document keeps them as declared.
	 */
	readonly at?: Visibility;
}

/**
 * **The declarations of one key, merged into the one schema the document holds its value to.**
 *
 * The document publishes each declaration in its own model and joins the models with `allOf`, so a
 * value at the key is valid where every declaration accepts it. This is that conjunction, worked out
 * as the document's own validator works it out, keyword family by keyword family:
 *
 * - a declaration whose type every other declaration's type admits is the value, with every
 *   declaration's keywords on it - a subtype, a derived scalar, a literal the others allow;
 * - a union is merged member by member, and a member no other declaration admits is dropped;
 * - two objects are merged key by key: a key one sealed side does not declare is refused, a key
 *   either requires is required, and a typed indexer holds every key it does not name;
 * - two lists are merged element by element, with every declaration's `@minItems` and `@maxItems`;
 * - two scalars of one JSON type that neither narrows are both checked, `.and()` between leaves.
 *
 * `null` is valid only where every declaration admits it, and a JSON type no declaration shares is no
 * value at all. Refused only where no one schema can say it: a merge that refers back to itself, and a
 * `@discriminated` union with a default variant, which this emitter refuses on its own.
 */
export type Merged =
	/** No value - `withheld` where a refused declaration leaves it so, not the document. */
	| { readonly kind: "never"; readonly withheld?: true }
	| { readonly kind: "refused"; readonly why: string; readonly recursive?: true }
	| {
			readonly kind: "type";
			readonly type: Type;
			readonly keywords: readonly Keyworded[];
			/** The visibility the type is published at, where it is not the merge's own - see `Part`. */
			readonly at?: Visibility;
	  }
	| { readonly kind: "whole"; readonly property: ModelProperty }
	| { readonly kind: "nullable"; readonly inner: Merged }
	| { readonly kind: "union"; readonly members: readonly Merged[]; readonly exclusive?: boolean }
	| { readonly kind: "all"; readonly parts: readonly Merged[] }
	| {
			readonly kind: "array";
			readonly element: Merged;
			readonly keywords: readonly Keyworded[];
			/** An array literal, whose element is computed and rendered at `Item` visibility. */
			readonly list?: Model;
	  }
	| MergedObject;

export interface MergedObject {
	readonly kind: "object";
	readonly members: readonly MergedMember[];
	/**
	 * What a key no member names may hold: nothing (`sealed`), anything, kept (`loose`) or stripped
	 * (`open`), or a value of a schema - a typed indexer.
	 */
	readonly rest: "sealed" | "open" | "loose" | Merged;
	/** Every key held to `rest`, and none declared: a dictionary. */
	readonly dictionary: boolean;
	readonly keywords: readonly Keyworded[];
	/** Where a refusal inside the indexer is reported. */
	readonly site: Type | undefined;
}

export interface MergedMember {
	readonly key: string;
	/** The declaration whose optionality, default and doc the member takes, or none where none states it. */
	readonly property: ModelProperty | undefined;
	readonly position: PropertyPosition;
}

const NOTHING: Merged = { kind: "never" };

/** No value because a declaration is refused - see `HeldDeclarations.refusedAt`. */
const WITHHELD: Merged = { kind: "never", withheld: true };

/** The part a property publishes: its declared type, or its encoded one, with its keywords. */
function partOfProperty(program: Program, property: ModelProperty): Part | undefined {
	const encoding = encodedValueOf(program, property);
	switch (encoding.kind) {
		case "unsatisfiable":
			return undefined;
		case "both":
			return { members: [], nullable: false, keywords: [], whole: property };
		case "replaced":
			return {
				members: [encoding.scalar],
				nullable: encoding.nullable,
				keywords: [property],
				type: encoding.scalar,
			};
		case "declared":
			return partOfType(
				program,
				property.type,
				[property],
				exclusiveSiteOf(program, property, property.type) !== undefined,
			);
	}
}

/**
 * The part a declared type is, its members spelled out. `exclusiveHere` where the property declaring
 * it makes its inline union a `oneOf` - see `exclusiveSiteOf`: merged under a redeclaration, `@oneOf
 * u: X1 | X2` was an `anyOf`, and `{ u: {} }`, which both members match, was accepted.
 */
function partOfType(
	program: Program,
	type: Type,
	keywords: readonly Keyworded[],
	exclusiveHere = false,
): Part {
	/**
	 * A `@discriminated` union is published as `oneOf` too: its tag makes the members disjoint, until
	 * a PATCH makes the tag optional, and `{ value: { a: "s" } }` then matches two open envelopes.
	 */
	const exclusive =
		exclusiveHere ||
		isExclusive(program, type) ||
		(type.kind === "Union" && getDiscriminatedUnion(program, type)[0] !== undefined);
	const members: Member[] = [];
	/**
	 * **How many members a `null` matches**, a nested union's included: kept whole, its `null` set
	 * nothing, and `@oneOf { v0: float | null, v1: string }` refused the `null` it accepts. Under
	 * `@oneOf` it is a value where exactly one member matches it.
	 */
	let nullMatches = 0;
	let refused: string | undefined;
	const visit = (each: Type): void => {
		if (each.kind === "UnionVariant") return visit(each.type);
		if (isNull(each)) {
			nullMatches += 1;
			return;
		}
		if (each.kind === "Union") {
			// A nested union is one member, whole, unless both are `anyOf` - see `alikeMembersOf`.
			if (each !== type && (exclusive || isPublishedOneOf(program, each))) {
				if (admitsNullValue(program, each)) nullMatches += 1;
				members.push(each);
				return;
			}
			const [discriminated] = getDiscriminatedUnion(program, each);
			if (discriminated !== undefined && discriminated.defaultVariant !== undefined) {
				refused = "it is a discriminated union with a default variant";
			}
			if (discriminated !== undefined && discriminated.options.envelope !== "none") {
				for (const [name, variant] of discriminated.variants) {
					members.push({
						kind: "Envelope",
						union: each,
						name: String(name),
						variant,
						discriminator: discriminated.options.discriminatorPropertyName,
						property: discriminated.options.envelopePropertyName,
					});
				}
				return;
			}
			for (const variant of each.variants.values()) visit(variant.type);
			return;
		}
		if (each.kind === "Enum") {
			members.push(...each.members.values());
			return;
		}
		if (isTypelessMember(program, each)) nullMatches += 1;
		members.push(each);
	};
	visit(type);
	return {
		members: exclusive ? withoutRepeatedLiterals(members) : members,
		nullable: exclusive ? nullMatches === 1 : nullMatches > 0,
		keywords,
		type,
		...(refused === undefined ? {} : { refused }),
		...(exclusive ? { exclusive: true } : {}),
	};
}

/** The `string` openapi3 adds as a discriminator where the model declaring it does not. */
function stringPart(program: Program): Part {
	const string = program.checker.getStdType("string");
	return { members: [string], nullable: false, keywords: [], type: string };
}

function isEnvelope(member: Member): member is Envelope {
	return member.kind === "Envelope";
}

/** A part with no JSON type of its own, which asserts only its keywords on whatever the value is. */
function isTypelessPart(program: Program, part: Part): boolean {
	return (
		part.whole === undefined &&
		part.members.length > 0 &&
		// `@oneOf { a: unknown, b: unknown }` is two members, which every value matches: none passes.
		!(part.exclusive === true && part.members.length > 1) &&
		part.members.every((member) => !isEnvelope(member) && isTypelessMember(program, member))
	);
}

/** Merges in flight, so one that reaches itself again is refused rather than followed forever. */
const mergesInFlight: (readonly Member[])[] = [];

export function mergeParts(program: Program, given: readonly (Part | undefined)[]): Merged {
	if (given.some((part) => part === undefined)) return NOTHING;
	const parts = given as readonly Part[];
	const refused = parts.find((part) => part.refused !== undefined)?.refused;
	if (refused !== undefined) return { kind: "refused", why: refused };
	const wholes = parts.filter((part) => part.whole !== undefined);
	if (wholes.length > 0) {
		const others = parts.filter((part) => part.whole === undefined);
		return {
			kind: "all",
			parts: [
				...wholes.map(
					(part) => ({ kind: "whole", property: part.whole as ModelProperty }) as const,
				),
				...(others.length === 0 ? [] : [mergeParts(program, others)]),
			],
		};
	}
	const keywordsOnly = parts.filter((part) => isTypelessPart(program, part));
	const typed = parts.filter((part) => !isTypelessPart(program, part));
	const loose = keywordsOnly.flatMap((part) => part.keywords);
	if (typed.length === 0) {
		/**
		 * **A `@oneOf` of a typeless member and `null` refuses the `null` both match**, and is its own
		 * union, whole: `@oneOf { a: unknown, b: null }` beside `unknown` accepted `null` as keywords.
		 */
		const nonNull = keywordsOnly.find((part) => !part.nullable && part.type !== undefined);
		if (nonNull !== undefined) {
			return { kind: "type", type: nonNull.type as Type, keywords: loose };
		}
		const first = keywordsOnly[0]?.members[0] ?? $(program).intrinsic.any;
		return { kind: "type", type: first as Type, keywords: loose };
	}
	// A typeless part admits `null` unless it is such a `@oneOf`, whose refusal stands.
	const nullable = parts.every((part) => part.nullable);
	if (typed.some((part) => part.members.length === 0)) {
		return nullable ? nullValue(program) : NOTHING;
	}
	const [first, ...rest] = typed as [Part, ...Part[]];
	const value = mergeNonNull(program, [
		{ ...first, keywords: [...first.keywords, ...loose] },
		...rest,
	]);
	return nullable ? orNullMerged(program, value) : value;
}

function nullValue(program: Program): Merged {
	return { kind: "type", type: $(program).intrinsic.null, keywords: [] };
}

function orNullMerged(program: Program, value: Merged): Merged {
	if (value.kind === "never") return nullValue(program);
	if (value.kind === "type" && hasNull(value.type)) return value;
	return { kind: "nullable", inner: value };
}

/** Parts that each admit no `null`, and are each one or more members. */
function mergeNonNull(program: Program, parts: readonly Part[]): Merged {
	/**
	 * **A member with no type asserts only its keywords**, here as at the top of a merge: split out of
	 * `@oneOf { v0: unknown, v1: string }` beside an envelope, `unknown` reached the intersection of two
	 * scalars and was refused as an unknown kind, `Envelope`, where the value is the envelope.
	 */
	const typeless = parts.filter((part) => isTypelessPart(program, part));
	if (typeless.length > 0 && typeless.length < parts.length) {
		const [first, ...rest] = parts.filter((part) => !isTypelessPart(program, part)) as [
			Part,
			...Part[],
		];
		const loose = typeless.flatMap((part) => part.keywords);
		return mergeNonNull(program, [{ ...first, keywords: [...first.keywords, ...loose] }, ...rest]);
	}
	const keywords = parts.flatMap((part) => part.keywords);
	const [only] = parts;
	if (parts.length === 1 && only !== undefined && only.members.length === 1) {
		const member = only.members[0] as Member;
		return isEnvelope(member)
			? mergeObjects(program, [only])
			: memberValue(program, member, only.keywords, only.at);
	}
	if (disjointParts(program, parts)) return NOTHING;
	// A part whose type every other part's admits is the value, every part's keywords on it.
	for (const candidate of parts) {
		const type = typeOfPart(candidate);
		if (type === undefined) continue;
		const scalars: Keyworded[] = [];
		const narrows = parts.every((other) => {
			if (other === candidate) return true;
			const target = typeOfPart(other);
			const each =
				target === undefined || !publishedAlike(program, target, candidate, other)
					? undefined
					: narrowsTo(program, type, target);
			if (each !== undefined) scalars.push(...each);
			return each !== undefined;
		});
		if (narrows) return memberValue(program, type, [...keywords, ...scalars], candidate.at);
	}
	/**
	 * **A nested union kept whole is spelled out where it meets another declaration**, its members
	 * held to the rest with its own exclusivity: `C` beside `@oneOf { v0: A | B, v1: string }` is
	 * `C & A` or `C & B`. Left whole, the two objects were joined with `.and()`, which pooled the keys
	 * a sealed side refuses and threw on the two defaults of `k`.
	 */
	const nested = parts.findIndex(
		(part) =>
			part.members.length === 1 &&
			!isEnvelope(part.members[0] as Member) &&
			(part.members[0] as Type).kind === "Union",
	);
	if (nested !== -1) {
		const part = parts[nested] as Part;
		const spelled = partOfType(program, part.members[0] as Type, part.keywords);
		if (spelled.members.length === 0) return NOTHING;
		return mergeNonNull(
			program,
			parts.map((each, index) =>
				index === nested ? { ...spelled, ...(part.at === undefined ? {} : { at: part.at }) } : each,
			),
		);
	}
	// A union is held to the rest member by member, and a member nothing else admits is dropped.
	const split = parts.findIndex((part) => part.members.length > 1);
	if (split !== -1) {
		const union = parts[split] as Part;
		const members = union.members.map((member) =>
			mergeNonNull(
				program,
				parts.map((part, index) =>
					index === split
						? {
								members: [member],
								nullable: false,
								keywords: union.keywords,
								...(union.at === undefined ? {} : { at: union.at }),
							}
						: part,
				),
			),
		);
		/**
		 * **A `@oneOf` holding a refused member validates nothing**: the document still counts the
		 * member, so a value it and another both match is refused there, and dropped here it was
		 * accepted - as a merge holding a refused declaration holds nothing.
		 */
		const refusal = members.find(holdsRefusal);
		if (union.exclusive === true && refusal !== undefined) return heldRefusalOf(refusal);
		const kept = members.filter((member) => member.kind !== "never");
		const [one] = kept;
		if (one === undefined) return NOTHING;
		// A `@oneOf` union stays exclusive member by member: each merged member matches where its own did.
		if (kept.length === 1) return one;
		return union.exclusive === true
			? { kind: "union", members: kept, exclusive: true }
			: { kind: "union", members: kept };
	}
	const members = parts.map((part) => part.members[0] as Member);
	const fixed = members.find(
		(member): member is Type => !isEnvelope(member) && literalValueOf(member) !== undefined,
	);
	if (fixed !== undefined) {
		const value = literalValueOf(fixed) as string | number | boolean;
		const admitted = members.every(
			(member) => !isEnvelope(member) && admitsValue(program, member, value),
		);
		const kept = keywords.every(
			(source) => brokenConstraintOf(program, source, value) === undefined,
		);
		return admitted && kept ? { kind: "type", type: fixed, keywords: [] } : NOTHING;
	}
	if (members.every((member) => isObjectMember(member))) return mergeObjects(program, parts);
	if (members.every((member) => !isEnvelope(member) && isListMember(member))) {
		return mergeLists(program, parts);
	}
	if (members.some((member) => !isEnvelope(member) && member.kind === "Tuple")) {
		return { kind: "refused", why: "a tuple is held to another declaration" };
	}
	// Two scalars of one JSON type that neither narrows: the value is checked against both.
	return {
		kind: "all",
		parts: parts.map((part) =>
			memberValue(program, part.members[0] as Type, part.keywords, part.at),
		),
	};
}

/**
 * **Whether a type is one schema at the visibility each of two parts is published at**, so that
 * what narrows it at one narrows it at the other. A record's value is published at the record's
 * visibility: `QX { x: M1 }` sent in a PATCH beside a `Record<M1>` holds `x` to `M1Update` and to
 * `M1`, and taken as narrowed by itself it was `M1Update` alone, `c` optional where `M1` requires it.
 */
function publishedAlike(program: Program, type: Type, one: Part, other: Part): boolean {
	const a = one.at ?? visibility;
	const b = other.at ?? visibility;
	if (
		a !== b &&
		renderedVisibilityOf(program, type, a) !== renderedVisibilityOf(program, type, b)
	) {
		return false;
	}
	const own = typeOfPart(one);
	return own === undefined || !elementsPublishedApart(program, own, a, type, b);
}

/** The one type a part stands for, where it can be rendered whole: a single member, or its union. */
function typeOfPart(part: Part): Type | undefined {
	if (part.members.length === 1) {
		const [member] = part.members;
		return member === undefined || isEnvelope(member) ? undefined : member;
	}
	if (part.members.some(isEnvelope)) return undefined;
	return part.type !== undefined && !hasNull(part.type) ? part.type : undefined;
}

/**
 * A member as the value, its keywords on it - a literal checked against them now - published at
 * `at` where its part is published apart from the merge: a record's value, at the record's.
 */
function memberValue(
	program: Program,
	type: Type,
	keywords: readonly Keyworded[],
	at?: Visibility,
): Merged {
	const value = literalValueOf(type);
	if (value === undefined)
		return { kind: "type", type, keywords, ...(at === undefined ? {} : { at }) };
	return keywords.every((source) => brokenConstraintOf(program, source, value) === undefined)
		? { kind: "type", type, keywords: [] }
		: NOTHING;
}

/** Whether the parts share no JSON type, so no value is one of each. */
function disjointParts(program: Program, parts: readonly Part[]): boolean {
	const typesOf = (part: Part): ReadonlySet<JsonType> | undefined => {
		const types = new Set<JsonType>();
		for (const member of part.members) {
			const each = isEnvelope(member)
				? new Set<JsonType>(["object"])
				: jsonTypesOf(program, member);
			if (each === undefined) return undefined;
			for (const type of each) types.add(type);
		}
		return types;
	};
	const numeric = (type: JsonType): boolean =>
		type === "integer" || type === "number" || type === "fraction";
	let shared: JsonType[] | undefined;
	for (const part of parts) {
		const types = typesOf(part);
		if (types === undefined) continue;
		shared =
			shared === undefined
				? [...types]
				: shared.filter((type) =>
						[...types].some((other) => other === type || (numeric(other) && numeric(type))),
					);
	}
	return shared !== undefined && shared.length === 0;
}

function isObjectMember(member: Member): boolean {
	if (isEnvelope(member)) return true;
	return member.kind === "Model" && effectiveIndexer(member)?.key.name !== "integer";
}

function isListMember(member: Type): boolean {
	return member.kind === "Model" && effectiveIndexer(member)?.key.name === "integer";
}

/** Lists merged element by element, with every declaration's list keywords. */
function mergeLists(program: Program, parts: readonly Part[]): Merged {
	const lists = parts.map((part) => part.members[0] as Model);
	// Array literals all, the element is an `Item`'s - see `atItem`.
	const [first] = lists;
	const literal = lists.every((list) => isArrayLiteral(program, list)) ? first : undefined;
	// Each list's element at its own visibility - a literal's with `Item`, a named list's without.
	const merge = (): Merged =>
		mergeParts(
			program,
			lists.map((list, index) => {
				const at = parts[index]?.at ?? visibility;
				return {
					...partOfType(program, (effectiveIndexer(list) as { value: Type }).value, []),
					at: isArrayLiteral(program, list) ? at | Visibility.Item : at,
				};
			}),
		);
	const element = literal === undefined ? merge() : atItem(program, literal, merge);
	return {
		kind: "array",
		element,
		keywords: parts.flatMap((part, index) => [...part.keywords, lists[index] as Model]),
		...(literal === undefined ? {} : { list: literal }),
	};
}

/** One member of an object a merge is made of. */
interface ShapeMember {
	readonly key: string;
	/** The declarations of the key, most derived first, each published at this position. */
	readonly declarations: readonly ModelProperty[];
	/** What no declaration states: an envelope's members, the discriminator openapi3 adds. */
	readonly beside: readonly Part[];
	/** openapi3 adds the key as a `string` to a model above a declaration of it. */
	readonly injected: boolean;
	readonly required: boolean;
}

/** An object as the document publishes it at a position, before it is merged with another. */
interface ObjectShape {
	readonly members: readonly ShapeMember[];
	readonly sealed: boolean;
	/** A string indexer's value, which every key no member names is held to. */
	readonly rest: Type | undefined;
	readonly dictionary: boolean;
	readonly keywords: readonly Keyworded[];
	readonly site: Type | undefined;
	/** The visibility it is published at - its indexer's value is published there too. */
	readonly at: Visibility;
}

/**
 * A model as the object it publishes at the current position, or `undefined` where it accepts
 * nothing - refused as `invalid-subtype-discriminator` or `sealed-base-extended`.
 */
function shapeOfModel(
	program: Program,
	model: Model,
	keywords: readonly Keyworded[],
): ObjectShape | undefined {
	if (unsatisfiableSubtype(program, model)) return undefined;
	const extension = sealedBaseExtensionOf(program, model);
	if (extension?.required === true) return undefined;
	const binding = bindingIndexerOf(model);
	const rest = binding !== undefined && !isNeverType(binding.value) ? binding.value : undefined;
	/**
	 * The keys the binding indexer's own model and those above it publish, which it does not hold. A
	 * key whose declaration openapi3 leaves out of the properties - see `atPublication` - is the
	 * indexer's: `additionalProperties` evaluates it.
	 */
	const exempt =
		binding === undefined
			? undefined
			: new Set(
					publishedPropertiesOf(program, binding.link).map(({ property }) =>
						rawPropertyKey(program, property),
					),
				);
	/**
	 * **A string indexer only means "dictionary" when the model declares NO properties** - read from
	 * the UNFILTERED list, because a model whose only properties are metadata is still a declared
	 * object rather than a dictionary.
	 */
	const dictionary = rest !== undefined && flattenedPropertiesOf(program, model).length === 0;
	const discriminators = discriminatorsOf(program, model);
	const injected = injectedDiscriminatorsOf(program, model);
	const published = new Map(
		publishedPropertiesOf(program, model).map((entry) => [
			rawPropertyKey(program, entry.property),
			entry,
		]),
	);
	const members: (ShapeMember & { readonly forbidden: boolean })[] = renderedPropertiesOf(
		program,
		model,
	)
		/**
		 * An optional property a template instance adds to a base openapi3 seals is refused by the
		 * document whenever it is sent - see `sealedBaseExtensionOf` - so it is not declared, and the
		 * sealed object refuses it too.
		 */
		.filter(
			({ property }) =>
				extension === undefined || !extension.keys.includes(rawPropertyKey(program, property)),
		)
		.flatMap(({ property, overridden }) => {
			const key = rawPropertyKey(program, property);
			const rendered = [property, ...overridden];
			const bound = binding !== undefined && exempt !== undefined && !exempt.has(key);
			// `required` is read where the model is reduced to, as openapi3 reads it.
			const required =
				discriminators.includes(key) ||
				rendered.some((declaration) => isRequiredAt(program, declaration));
			const entry = published.get(key);
			/**
			 * **A key no published declaration states is held by what covers it in the document**: the
			 * indexer, or the `string` openapi3 adds for a discriminator, below. One nothing covers is
			 * `split-visibility`, refused, and keeps the declaration it was rendered from.
			 */
			if (entry === undefined && required && discriminators.includes(key)) return [];
			const declarations =
				entry !== undefined
					? [entry.property, ...entry.overridden]
					: bound && rest !== undefined
						? []
						: rendered;
			return [
				{
					key,
					declarations,
					// A key the binding indexer holds is held to its value as well - see `bindingIndexerOf`.
					beside: bound && rest !== undefined ? [partOfType(program, rest, [])] : [],
					forbidden: bound && rest === undefined,
					injected: injected.includes(key),
					required,
				},
			];
		});
	// A key a `Record<never>` above it refuses: no value where it is required, refused where sent.
	if (members.some((member) => member.forbidden && member.required)) return undefined;
	/**
	 * **The discriminator openapi3 adds where nothing declares it**, a required `string`, on the base
	 * and - through `allOf` - on every model under it, an intermediate subtype standing alone included.
	 */
	for (const key of discriminators) {
		if (members.some((member) => member.key === key)) continue;
		members.push({
			key,
			declarations: [],
			beside: [stringPart(program)],
			forbidden: false,
			injected: false,
			required: true,
		});
	}
	return {
		members: members.filter((member) => !member.forbidden),
		sealed: rest === undefined && (binding !== undefined || isSealed(model)),
		rest,
		dictionary,
		keywords: [...keywords, model],
		site: model,
		at: visibility,
	};
}

/**
 * **The indexer that holds a model's keys: the TOPMOST string indexer in its chain.**
 *
 * openapi3 publishes a root model's indexer as `additionalProperties`, which holds every key the
 * model does not declare itself - a subtype's own keys included, since the subtype is `allOf` the
 * root - and a lower model's as `unevaluatedProperties`, which the root's has already evaluated. So
 * the topmost indexer holds every key its own model and those above it do not declare, and any below
 * it never applies. Read as the nearest, a subtype's `m: Inner2` escaped the base's
 * `...Record<Inner>` and a subtype's own indexer refused keys the document accepts.
 */
export function bindingIndexerOf(
	model: Model,
): { readonly link: Model; readonly value: Type } | undefined {
	let binding: { link: Model; value: Type } | undefined;
	for (let link: Model | undefined = model; link !== undefined; link = link.baseModel) {
		if (link.indexer?.key.name === "string") binding = { link, value: link.indexer.value };
	}
	return binding;
}

/** The wrapper openapi3 publishes for an envelope, as an object of its two required members. */
function shapeOfEnvelope(program: Program, envelope: Envelope): ObjectShape {
	const tag = $(program).literal.createString(envelope.name);
	// Published where the union reduces to - see `envelopeVisibilityOf` - not where a merge spells it out.
	const at = envelopeVisibilityOf(program, envelope.union, envelope.variant);
	// Both optional where a PATCH makes them so, as the envelope is published.
	const required = !implicitlyOptional(at);
	return {
		members: [
			{
				key: envelope.discriminator,
				declarations: [],
				beside: [{ members: [tag], nullable: false, keywords: [], type: tag }],
				injected: false,
				required,
			},
			{
				key: envelope.property,
				declarations: [],
				// At the envelope's visibility: a list literal's at `Item`, beside a named list's without.
				beside: [{ ...partOfType(program, envelope.variant, []), at }],
				injected: false,
				required,
			},
		],
		sealed: sealObjectSchemas,
		rest: undefined,
		dictionary: false,
		keywords: [],
		site: envelope.union,
		at,
	};
}

/** Objects merged key by key - see {@link Merged}. */
function mergeObjects(program: Program, parts: readonly Part[]): Merged {
	const members = parts.map((part) => part.members[0] as Member);
	if (
		mergesInFlight.some(
			(entry) =>
				entry.length === members.length && entry.every((member) => members.includes(member)),
		)
	) {
		return { kind: "refused", why: "the merged value refers back to itself", recursive: true };
	}
	mergesInFlight.push(members);
	try {
		const shapes: ObjectShape[] = [];
		for (const [index, member] of members.entries()) {
			const part = parts[index] as Part;
			const requested = part.at ?? visibility;
			const at = isEnvelope(member) ? requested : renderedVisibilityOf(program, member, requested);
			/**
			 * A component openapi3 publishes split - refused as `split-visibility` wherever it is
			 * rendered - holds a value to a schema no value satisfies, and so does every merge holding it.
			 * Merged from its declared shape, `Sub` accepted what its `allOf` refuses.
			 */
			if (!isEnvelope(member) && isPublishedSplit(program, member, at)) return WITHHELD;
			if (!isEnvelope(member) && held.refusedAt(member as Model, at)) return WITHHELD;
			const shape = withVisibility(at, () =>
				isEnvelope(member)
					? shapeOfEnvelope(program, member)
					: shapeOfModel(program, member as Model, part.keywords),
			);
			if (shape === undefined) return NOTHING;
			shapes.push(shape);
		}
		return mergeShapes(program, shapes);
	} finally {
		mergesInFlight.pop();
	}
}

function mergeShapes(program: Program, shapes: readonly ObjectShape[]): Merged {
	const keys = [...new Set(shapes.flatMap((shape) => shape.members.map((member) => member.key)))];
	/**
	 * Each declaration at the visibility its shape is published at - see `positionOfDeclarations` -
	 * wherever that is not where the merge is rendered: `M13[]` beside a named list under a PATCH holds
	 * its element at `Item`, where `M13` is canonical, and its `a: M14` rendered at the PATCH was
	 * `M14Update`, `d` optional where the document's `M14` requires it.
	 */
	const apart = shapes.some((shape) => shape.at !== visibility);
	const members: MergedMember[] = [];
	for (const key of keys) {
		const present: ShapeMember[] = [];
		const declaredAt: Visibility[] = [];
		const beside: Part[] = [];
		let forbidden = false;
		for (const shape of shapes) {
			const member = shape.members.find((each) => each.key === key);
			if (member !== undefined) {
				present.push(member);
				declaredAt.push(...member.declarations.map(() => shape.at));
			} else if (shape.sealed) forbidden = true;
			else if (shape.rest !== undefined) {
				beside.push({ ...partOfType(program, shape.rest, []), at: shape.at });
			}
		}
		const required = present.some((member) => member.required);
		// A key a sealed side does not declare: refused when sent, and so no value where it is required.
		if (forbidden) {
			if (required) return NOTHING;
			continue;
		}
		const declarations = present.flatMap((member) => member.declarations);
		const stated = present.flatMap((member) => member.beside);
		const injected = present.some((member) => member.injected);
		const [own, ...ancestors] = declarations;
		if (own === undefined) {
			members.push({
				key,
				property: undefined,
				position: { ...OWN_POSITION, required, value: mergeParts(program, [...stated, ...beside]) },
			});
			continue;
		}
		members.push({
			key,
			property: own,
			position: positionOfDeclarations(program, own, ancestors, {
				required,
				injected,
				beside: [...stated, ...beside],
				...(apart ? { at: declaredAt } : {}),
			}),
		});
	}
	return {
		kind: "object",
		members,
		rest: mergedRest(program, shapes),
		dictionary: shapes.every((shape) => shape.dictionary),
		keywords: shapes.flatMap((shape) => shape.keywords),
		site: shapes.length === 1 ? shapes[0]?.site : undefined,
	};
}

/** What a key no member names may hold, across every shape merged. */
function mergedRest(program: Program, shapes: readonly ObjectShape[]): MergedObject["rest"] {
	if (shapes.some((shape) => shape.sealed)) return "sealed";
	const typed = shapes.filter((shape) => shape.rest !== undefined);
	if (typed.length === 0) return "open";
	// `...Record<unknown>` keeps what it is sent; a typed indexer, or a typeless scalar, is a schema.
	if (typed.every((shape) => isUnknownType(shape.rest as Type))) return "loose";
	return mergeParts(
		program,
		typed.map((shape) => ({ ...partOfType(program, shape.rest as Type, []), at: shape.at })),
	);
}

/**
 * **Whether a merged value refuses anything a declaration states**, at any depth: a refused merge, a
 * key whose declarations cannot be merged, or a refused declaration it holds. Such a value is not
 * what the document publishes, so a `@oneOf` cannot count a value against it as the document does.
 */
function holdsRefusal(value: Merged): boolean {
	switch (value.kind) {
		case "never":
			return value.withheld === true;
		case "refused":
			return true;
		case "object":
			return value.members.some(
				(member) =>
					member.position.refused !== undefined ||
					(member.position.value !== undefined && holdsRefusal(member.position.value)),
			);
		case "nullable":
			return holdsRefusal(value.inner);
		case "array":
			return holdsRefusal(value.element);
		case "union":
			return value.members.some(holdsRefusal);
		case "all":
			return value.parts.some(holdsRefusal);
		default:
			return false;
	}
}

/**
 * **The refusal a value holds, as the value's own**: the first merge it refuses, at any depth, so the
 * declaration holding the value reports why - `LeafB.u`, where `D6` meets `@oneOf { M3, M5 }` and
 * a tuple meets a list. A refused declaration it holds has reported itself, and leaves no value.
 */
function heldRefusalOf(value: Merged): Merged {
	switch (value.kind) {
		case "refused":
			return value;
		case "object":
			for (const member of value.members) {
				const refused = member.position.refused;
				if (refused !== undefined) {
					return {
						kind: "refused",
						why: refused.why,
						...(refused.recursive ? { recursive: true as const } : {}),
					};
				}
				const inner = member.position.value;
				if (inner !== undefined && holdsRefusal(inner)) return heldRefusalOf(inner);
			}
			return WITHHELD;
		case "nullable":
			return heldRefusalOf(value.inner);
		case "array":
			return heldRefusalOf(value.element);
		case "union": {
			const held = value.members.find(holdsRefusal);
			return held === undefined ? WITHHELD : heldRefusalOf(held);
		}
		case "all": {
			const held = value.parts.find(holdsRefusal);
			return held === undefined ? WITHHELD : heldRefusalOf(held);
		}
		default:
			return WITHHELD;
	}
}

/**
 * The first refusal a merged value holds outside an object's declared members, which report their
 * own. A member no declaration states - an envelope's `value` - has no one to report it, so its
 * refusal is the enclosing value's; left there, a recursive merge through an envelope was emitted as
 * `z.never()` with nothing said.
 */
function refusalIn(value: Merged): Extract<Merged, { kind: "refused" }> | undefined {
	switch (value.kind) {
		case "object":
			return value.members
				.filter((member) => member.property === undefined)
				.map((member) =>
					member.position.value === undefined ? undefined : refusalIn(member.position.value),
				)
				.find((refusal) => refusal !== undefined);
		case "refused":
			return value;
		case "nullable":
			return refusalIn(value.inner);
		case "array":
			return refusalIn(value.element);
		case "union":
			return value.members.map(refusalIn).find((why) => why !== undefined);
		case "all":
			return value.parts.map(refusalIn).find((why) => why !== undefined);
		default:
			return undefined;
	}
}

/** The indexer in force, which a model can inherit - `model X extends Record<unknown>`. */
export function effectiveIndexer(model: Model): Model["indexer"] {
	for (let link: Model | undefined = model; link !== undefined; link = link.baseModel) {
		if (link.indexer !== undefined) return link.indexer;
	}
	return undefined;
}

/**
 * The subtypes a `@discriminator` base dispatches to: the models its document's `mapping` names.
 *
 * **The compiler's own reading, which is what openapi3 writes the mapping from.** A derived model
 * that declares no value for the discriminator is looked through to the models derived from it
 * that do. This used to be the base's DIRECT subtypes, so `Animal` -> `Mammal` (no `kind`) -> `Cat`
 * dispatched to `Mammal`, which carries no literal `kind`, and Zod threw "Invalid discriminated union
 * option" on every parse - a known kind, an unknown one, anything - while `Cat`, the model the
 * mapping names for `"cat"`, was not in the dispatch at all.
 *
 * Filtered by openapi3's own {@link includeDerivedModel} so a template declaration is not mistaken
 * for a real subtype - the same rule that decides whether a base may be sealed.
 */
export function discriminatedSubtypes(program: Program, model: Model): readonly Model[] {
	const discriminator = getDiscriminator(program, model);
	if (discriminator === undefined) return [];
	return mappedSubtypes(program, model).filter(
		(derived) =>
			extendsModel(derived, model) &&
			invalidSubtypeOf(program, derived, discriminator.propertyName) === undefined &&
			// Refused as `split-visibility`, it is `z.never()`, which no dispatch can hold.
			!isPublishedSplit(program, derived, renderedVisibilityOf(program, derived, visibility)),
	);
}

/**
 * **Whether a subtype is published as `allOf` the base at all.** `Create<Pet>` is a model of its
 * own, its mapping the canonical `Cat`'s, which holds `x` to `B` where `CreatePet` holds it to
 * `CreateB`: the document validates a value by `CreatePet`'s own properties, and dispatched to `Cat`
 * it accepted the `B` that `CreatePet` refuses.
 */
function extendsModel(derived: Model, model: Model): boolean {
	for (let link = derived.baseModel; link !== undefined; link = link.baseModel) {
		if (link === model) return true;
	}
	return false;
}

/**
 * The subtypes a discriminated base dispatches to, each with the discriminator value its mapping
 * names it for - see {@link discriminatedSubtypes}.
 */
export function dispatchedSubtypesOf(
	program: Program,
	model: Model,
): readonly (readonly [string, Model])[] {
	const discriminator = getDiscriminator(program, model);
	if (discriminator === undefined) return [];
	const held = new Set(discriminatedSubtypes(program, model));
	const { variants } = ignoreDiagnostics(
		getDiscriminatedUnionFromInheritance(model, discriminator),
	);
	return [...variants].filter(([, derived]) => held.has(derived));
}

/** Every model the base's `mapping` names, whether or not a dispatch can hold it. */
function mappedSubtypes(program: Program, model: Model): readonly Model[] {
	const discriminator = getDiscriminator(program, model);
	if (discriminator === undefined) return [];
	const { variants } = ignoreDiagnostics(
		getDiscriminatedUnionFromInheritance(model, discriminator),
	);
	return [...new Set(variants.values())].filter((derived) => includeDerivedModel(derived));
}

/**
 * **Why a model the mapping names cannot be dispatched to, or `undefined` where it can.**
 *
 * A dispatch reads one fixed value per subtype - `z.discriminatedUnion` has no other way to choose -
 * and the document's `mapping` names a subtype for exactly the values its discriminator fixes. Two
 * declarations break that, and each used to break the emitted module:
 *
 * - **a discriminator that is not one fixed value** - `kind: "lab" | string`, or a subtype that
 *   renames `kind` with `@encodedName` so the `kind` it publishes is its base's open `string`. Zod
 *   threw "Invalid discriminated union option" on the first parse, or on import.
 * - **a value a declaration above it refuses** - `kind: "cobra"` under `@maxLength(3) kind: string`.
 *   The document publishes the subtype as `allOf` that base, so no value is one; validated as its own
 *   declaration alone, every `"cobra"` was accepted.
 *
 * Each is refused as `invalid-subtype-discriminator`, as `undeclared-discriminator` refuses a
 * discriminator the document cannot state, and the base dispatches to its other subtypes.
 */
export function invalidSubtypeOf(
	program: Program,
	subtype: Model,
	propertyName: string,
):
	| { readonly why: string; readonly satisfiable: boolean; readonly invisibleAt?: Visibility }
	| undefined {
	const entry = publishedPropertiesOf(program, subtype).find(
		({ property }) => rawPropertyKey(program, property) === propertyName,
	);
	const values = entry === undefined ? undefined : fixedValuesOf(entry.property.type);
	/**
	 * **Fixed, but not where openapi3 reads it**: `Cat { @visibility(Lifecycle.Read) kind: "cat" }`
	 * first reached from a create body is published without its `kind`, which `Pet`'s `string` holds
	 * in its place - see `atPublication`. Told "it publishes 'kind' as 'string'", the author was not
	 * told why their `"cat"` was not it.
	 */
	const hidden =
		values !== undefined
			? undefined
			: flattenedPropertiesOf(program, subtype)
					.filter(({ property }) => rawPropertyKey(program, property) === propertyName)
					.flatMap(({ property, overridden }) => [property, ...overridden])
					.find(
						(declaration) =>
							fixedValuesOf(declaration.type) !== undefined &&
							!atPublication(program, declaration, () => isPayloadProperty(program, declaration)),
					);
	if (hidden !== undefined) {
		const at = atPublication(program, hidden, () => visibility);
		const instead =
			entry === undefined
				? "the 'string' openapi3 adds"
				: `'${entry.property.model?.name ?? "its base"}''s '${getTypeName(entry.property.type)}'`;
		return {
			why: `its '${propertyName}' is not visible at '${visibilityName(at)}', where openapi3 reads the properties of '${hidden.model?.name ?? subtype.name}', so it publishes ${instead} in its place, which is not one fixed value`,
			satisfiable: true,
			invisibleAt: at,
		};
	}
	/**
	 * **Declared, but not where the request is**: `@visibility(Lifecycle.Read) kind: "dog"` is no
	 * part of the schema at `Create`, which publishes the `string` openapi3 adds in its place. Told as
	 * "declare it as one fixed value", the author was sent to the declaration already there.
	 */
	if (entry === undefined && declaresKey(program, subtype, propertyName)) {
		return {
			why: `its '${propertyName}' is not visible at '${visibilityName(visibility)}', where it publishes the 'string' openapi3 adds in its place, which is not one fixed value`,
			satisfiable: true,
			invisibleAt: visibility,
		};
	}
	if (entry === undefined || values === undefined) {
		// Renamed away, the key it publishes is the `string` openapi3 adds where no model declares it.
		const declared =
			entry !== undefined
				? `'${getTypeName(entry.property.type)}'`
				: injectedDiscriminatorsOf(program, subtype).includes(propertyName)
					? "the 'string' openapi3 adds where no model above declares it"
					: "nothing";
		return {
			why: `it publishes '${propertyName}' as ${declared}, which is not one fixed value`,
			satisfiable: true,
		};
	}
	for (const ancestor of entry.overridden) {
		const owner = ancestor.model?.name ?? "its base";
		const published = publishedJsonTypeOf(program, ancestor);
		if (published !== undefined && published !== "string") {
			return {
				why: `it fixes '${propertyName}' as a string, which '${owner}' publishes as a JSON ${published}, so no value is one`,
				satisfiable: false,
			};
		}
		for (const value of values) {
			const broken =
				brokenConstraintOf(program, ancestor, value) ??
				refusedValueOf(program, ancestor.type, value);
			if (broken !== undefined) {
				return {
					why: `it fixes '${propertyName}' as '${value}', which '${owner}' refuses with ${broken}, so no value is one`,
					satisfiable: false,
				};
			}
		}
	}
	return undefined;
}

/** Whether a model or one above it declares a key, visible or not. */
function declaresKey(program: Program, model: Model, key: string): boolean {
	for (let link: Model | undefined = model; link !== undefined; link = link.baseModel) {
		for (const property of link.properties.values()) {
			if (rawPropertyKey(program, property) === key) return true;
		}
	}
	return false;
}

/** A visibility as its flags read: `Update | Patch`, `Create | Item`. */
export function visibilityName(at: Visibility): string {
	const flags: [string, Visibility][] = [
		["Read", Visibility.Read],
		["Create", Visibility.Create],
		["Update", Visibility.Update],
		["Delete", Visibility.Delete],
		["Query", Visibility.Query],
		["Patch", Visibility.Patch],
		["Item", Visibility.Item],
	];
	return flags
		.filter(([, flag]) => (at & flag) !== 0)
		.map(([named]) => named)
		.join(" | ");
}

/**
 * Why a declared type refuses a string value, read without running anything - or `undefined` where
 * it admits it. A union admits what any member admits, so `kind: K2 | null`, with `K2` a scalar whose
 * base declares `@maxLength(3)`, refuses `"cobra"` through `K2`'s chain.
 */
function refusedValueOf(program: Program, type: Type, value: string): string | undefined {
	switch (type.kind) {
		case "Scalar": {
			const json = jsonTypeOfScalar(program, type);
			if (json !== undefined && json !== "string") return `its type, a JSON ${json}`;
			return brokenConstraintOf(program, type, value);
		}
		case "String":
			return type.value === value ? undefined : `its value '${type.value}'`;
		case "EnumMember":
			return (type.value ?? type.name) === value ? undefined : `its value`;
		case "Enum":
		case "Union": {
			const reasons = membersOf(type).map((member) => refusedValueOf(program, member, value));
			return reasons.includes(undefined) ? undefined : `'${getTypeName(type)}'`;
		}
		case "Intrinsic":
			return type.name === "unknown" ? undefined : `'${type.name}'`;
		case "Model":
		case "Tuple":
		case "Number":
		case "Boolean":
			return `'${getTypeName(type)}'`;
		default:
			return undefined;
	}
}

/**
 * **Whether a model is a subtype its base's mapping names that no value can be** - its fixed
 * discriminator refused by a declaration above it. Refused as `invalid-subtype-discriminator` and
 * emitted as nothing, so used directly as a body it accepts nothing, as the document does, where it
 * used to accept its own declaration.
 */
export function unsatisfiableSubtype(program: Program, model: Model): boolean {
	for (let base = model.baseModel; base !== undefined; base = base.baseModel) {
		const discriminator = getDiscriminator(program, base);
		if (discriminator === undefined || !mappedSubtypes(program, base).includes(model)) continue;
		if (invalidSubtypeOf(program, model, discriminator.propertyName)?.satisfiable === false) {
			return true;
		}
	}
	return false;
}

/** The JSON type a scalar-valued property is published as, `@encode` included. */
function publishedJsonTypeOf(program: Program, property: ModelProperty): JsonType | undefined {
	const encoding = encodedValueOf(program, property);
	if (encoding.kind === "replaced" || encoding.kind === "both") {
		return jsonTypeOfScalar(program, encoding.scalar);
	}
	const type = nullableInnerOf(property.type) ?? property.type;
	return type.kind === "Scalar" ? jsonTypeOfScalar(program, type) : undefined;
}

/** The fixed string values a discriminator's type allows, or `undefined` where it is open. */
function fixedValuesOf(type: Type): readonly string[] | undefined {
	switch (type.kind) {
		case "String":
			return [type.value];
		case "EnumMember":
			return typeof type.value === "number" ? undefined : [type.value ?? type.name];
		case "UnionVariant":
			return fixedValuesOf(type.type);
		case "Enum":
		case "Union": {
			const values: string[] = [];
			for (const member of membersOf(type)) {
				const fixed = fixedValuesOf(member);
				if (fixed === undefined) return undefined;
				values.push(...fixed);
			}
			return values;
		}
		default:
			return undefined;
	}
}

/** `invalid-subtype-discriminator` for every model a base's mapping names that cannot be dispatched to. */
function reportInvalidSubtypes(program: Program, model: Model): void {
	const discriminator = getDiscriminator(program, model);
	if (discriminator === undefined) return;
	for (const subtype of mappedSubtypes(program, model)) {
		const invalid = invalidSubtypeOf(program, subtype, discriminator.propertyName);
		if (
			invalid === undefined ||
			!firstReportOf(program, "invalid-subtype-discriminator", subtype)
		) {
			continue;
		}
		reportDiagnostic(program, {
			code: "invalid-subtype-discriminator",
			messageId: invalid.invisibleAt === undefined ? "default" : "invisible",
			target: subtype,
			format: {
				name: subtype.name,
				base: model.name,
				property: discriminator.propertyName,
				why: invalid.why,
				at: visibilityName(invalid.invisibleAt ?? visibility),
			},
		});
	}
}

/**
 * **A model extending a base that openapi3 seals because it does not count the model as derived.**
 *
 * openapi3 seals a model with no derived models it publishes, and a template instance is not one
 * (`includeDerivedModel`). So with `seal-object-schemas` on, `Pet<string> extends Animal` leaves
 * `Animal` sealed, and `Pet<string>` - published as `allOf` that sealed `Animal` - refuses every
 * value carrying a property `Pet<string>` adds, since `Animal`'s own `unevaluatedProperties` cannot
 * see it. Validated as its own flattened properties, such a value was accepted. Returns the sealed
 * base and the keys it refuses, or `undefined` where nothing is refused.
 */
export function sealedBaseExtensionOf(
	program: Program,
	model: Model,
):
	| { readonly base: Model; readonly keys: readonly string[]; readonly required: boolean }
	| undefined {
	if (includeDerivedModel(model)) return undefined;
	for (let base = model.baseModel; base !== undefined; base = base.baseModel) {
		if (!isSealed(base)) continue;
		const sealed = new Set(
			publishedPropertiesOf(program, base).map(({ property }) => rawPropertyKey(program, property)),
		);
		const added = publishedPropertiesOf(program, model)
			.map(({ property }) => property)
			.filter((property) => !sealed.has(rawPropertyKey(program, property)));
		if (added.length === 0) return undefined;
		return {
			base,
			keys: added.map((property) => rawPropertyKey(program, property)),
			// Only a REQUIRED addition leaves no value; an optional one the document refuses only when sent.
			required: added.some((property) => !(property.optional || isOptionalAt(program, property))),
		};
	}
	return undefined;
}

/**
 * **How a `@discriminator` base is validated: as the document's base, deserialized as the subtype
 * its discriminator names where the value is one.**
 *
 * The document publishes the base as an object of its own properties beside `discriminator:
 * {propertyName, mapping}`, and every subtype as `allOf` that base. OAS 3.1.1 section 4.8.25 is
 * normative that the discriminator "MUST NOT change the validation outcome of the schema", and
 * section 4.8.25.2 that in this `allOf` form validating the parent "does not perform a search for
 * child schemas or use them in validation in any way" - restated in 3.2.0 and 3.2.1, and by the
 * spec's editors (OAI/OpenAPI-Specification#3901: "`discriminator` only really helps with things
 * like code generation and data de-serialization. It doesn't help with validation"). Ajv defines it
 * as a no-op for validation.
 *
 * **So the verdict is the base's, and the subtype is a deserialization.** A union of the dispatch
 * and the base accepts exactly what the base accepts - every subtype is `allOf` the base, so a valid
 * subtype is a valid base - and hands back, for a value that is a valid instance of the subtype its
 * discriminator names, that subtype with its own properties, as an SDK deserializing the same body
 * would. A value naming no subtype, or one that is not a valid instance of the subtype it names, is
 * the base.
 *
 * Before 0.30.0 this emitter refused a value naming no subtype, and 0.30.0 then guarded the base
 * against a value naming a subtype, so a `"golden"` value missing `Golden`'s own fields was refused
 * though the document accepts it as a `Dog`. Both made the validator stricter than the document it
 * exists to agree with.
 */
export interface DiscriminatedBase {
	/** The discriminator's wire name. */
	readonly propertyName: string;
	/** The subtypes a `z.discriminatedUnion` dispatches to, each carrying literal discriminator values. */
	readonly dispatched: readonly Model[];
	/**
	 * Subtypes that are themselves discriminated bases, and so `z.union`s with no literal values to
	 * dispatch on; no `z.discriminatedUnion` can hold one, so each sits beside the dispatch.
	 */
	readonly beside: readonly Model[];
}

export function discriminatedBaseOf(program: Program, model: Model): DiscriminatedBase | undefined {
	const discriminator = getDiscriminator(program, model);
	const subtypes = discriminatedSubtypes(program, model);
	if (discriminator === undefined || subtypes.length === 0) return undefined;
	const beside = subtypes.filter((subtype) => discriminatedBaseOf(program, subtype) !== undefined);
	return {
		propertyName: discriminator.propertyName,
		dispatched: subtypes.filter((subtype) => !beside.includes(subtype)),
		beside,
	};
}

/** What the registry knows of the declarations a value refers to, which the value is built around. */
export interface HeldDeclarations {
	/**
	 * **A declaration refused as validating nothing - a collision - which no dispatch can hold**: its
	 * validator is `z.never()`, and `z.discriminatedUnion` throws on every parse given one. The
	 * registry re-renders a dispatch that held it before the refusal.
	 */
	readonly refused: (expression: string) => boolean;
	/**
	 * **A declaration annotated `z.ZodType<T>`, which no dispatch can hold**: the annotation
	 * `z.lazy()` requires for a recursive declaration erases the literal values
	 * `z.discriminatedUnion` reads, and the module failed to typecheck with `TS2322` - "not
	 * assignable to `$ZodTypeDiscriminable`".
	 */
	readonly annotated: (expression: string) => boolean;
	/**
	 * **A type whose declaration at a visibility is refused** - as a collision, or as
	 * `split-visibility` - which a merge or a `@oneOf` holding it holds to nothing. The registry
	 * re-renders a value that asked before the refusal.
	 */
	readonly refusedAt: (type: Type, at: Visibility) => boolean;
	/**
	 * **A type whose declaration at a visibility holds a refused one anywhere it refers to** - see
	 * `holdsRefusedMember`. The registry re-renders a value that asked before the refusal.
	 */
	readonly holdsRefusalAt: (type: Type, at: Visibility) => boolean;
}

const NOTHING_HELD: HeldDeclarations = {
	refused: () => false,
	annotated: () => false,
	refusedAt: () => false,
	holdsRefusalAt: () => false,
};

let held: HeldDeclarations = NOTHING_HELD;

export function withHeldDeclarations<T>(given: HeldDeclarations, run: () => T): T {
	const previous = held;
	held = given;
	try {
		return run();
	} finally {
		held = previous;
	}
}

/**
 * **The record a sealed model's 3.0 document cannot see**, or `undefined`. openapi3's 3.0 sealing is
 * `additionalProperties: { not: {} }` beside the model's own `properties` - it re-declares a base's
 * properties there, so they survive - and a base that is a record declares none: `model M extends
 * Record<string> { name: string }` sealed refuses every key the record admits, where 3.1's
 * `unevaluatedProperties` sees the record through `allOf`. Mirrors {@link isSealed}: sealed here,
 * with an ancestor whose indexer admits a value.
 */
export function unpublishableRecordOf(program: Program, model: Model): Model | undefined {
	if (!publishesOpenApi30(program) || model.indexer !== undefined || !isSealed(model)) {
		return undefined;
	}
	for (let base = model.baseModel; base !== undefined; base = base.baseModel) {
		if (base.indexer !== undefined && !isNeverType(base.indexer.value)) return base;
	}
	return undefined;
}

/** Refused where the 3.0 document seals away a base's record - see `unpublishable-record`. */
function refuseUnpublishableRecord(program: Program, model: Model, base: Model): string {
	const target = refusalTarget(model);
	if (firstReportOf(program, "unpublishable-record", target)) {
		reportDiagnostic(program, {
			code: "unpublishable-record",
			target,
			format: { type: getTypeName(model), base: getTypeName(base) },
		});
	}
	return UNREPRESENTABLE;
}

function modelToZod(program: Program, model: Model): string {
	const record = unpublishableRecordOf(program, model);
	if (record !== undefined) return refuseUnpublishableRecord(program, model, record);
	/**
	 * **A `@discriminator` base is its own object, deserialized as a subtype where the value is one.**
	 * See {@link DiscriminatedBase}.
	 *
	 * `z.discriminatedUnion` is the dispatch, and composes both ways this corpus needs. Measured on
	 * Zod 4.4.3: a union may be an OPTION of another union, and an option carrying a getter that refers
	 * back to the union being defined does **not** throw, because the discriminator is read without
	 * enumerating the rest of the shape. `Eagle.friends?: Bird[]` is exactly that. A nested base is a
	 * `z.union` itself, with no literal values to dispatch on, so it sits beside the dispatch.
	 *
	 * The base arm comes last: `z.union` hands back the first arm that accepts, so a valid subtype is
	 * deserialized as that subtype, and only a value no subtype accepts is the base.
	 */
	reportInvalidSubtypes(program, model);
	const base = discriminatedBaseOf(program, model);
	if (base !== undefined) {
		const arms: string[] = [];
		const options = base.dispatched
			.map((derived) => typeToZod(program, derived))
			.filter((option) => !held.refused(option));
		const dispatched = options.filter((option) => !held.annotated(option));
		if (dispatched.length > 0) {
			arms.push(`z.discriminatedUnion(${literal(base.propertyName)}, [${dispatched.join(", ")}])`);
		}
		arms.push(...options.filter((option) => held.annotated(option)));
		arms.push(...base.beside.map((derived) => typeToZod(program, derived)));
		arms.push(modelObjectToZod(program, model));
		return `z.union([${arms.join(", ")}])`;
	}
	return modelObjectToZod(program, model);
}

/**
 * A model as the object of its own properties, inherited ones included.
 *
 * **Given a discriminated base, this is its base arm**: the same object, with the required `string`
 * openapi3 adds to the base's properties where the base declares no discriminator of its own.
 */
function modelObjectToZod(program: Program, model: Model): string {
	// Refused as `invalid-subtype-discriminator`, by the base whose mapping names it.
	if (unsatisfiableSubtype(program, model)) return UNREPRESENTABLE;
	if (reportSealedBaseExtended(program, model)) return UNREPRESENTABLE;
	const indexer = effectiveIndexer(model);
	if (indexer?.key.name === "integer") {
		const element = atItem(program, model, () => typeToZod(program, indexer.value));
		return applyConstraints(program, `z.array(${element})`, model);
	}
	return mergedToZod(program, objectOfModel(program, model));
}

/** `sealed-base-extended` for a model a sealed base leaves no value of, and whether it was one. */
function reportSealedBaseExtended(program: Program, model: Model): boolean {
	const extension = sealedBaseExtensionOf(program, model);
	if (extension?.required !== true) return false;
	const name = getTypeName(model, { namespaceFilter: () => false });
	// Keyed on the instance as well: `Twice<string>` and `Twice<int32>` are one node, two findings.
	if (firstReportOf(program, "sealed-base-extended", model, name)) {
		reportDiagnostic(program, {
			code: "sealed-base-extended",
			target: model,
			format: {
				name,
				base: getTypeName(extension.base, { namespaceFilter: () => false }),
				keys: extension.keys.map((key) => `'${key}'`).join(", "),
			},
		});
	}
	return true;
}

/**
 * A model as the object it publishes at the current position: the merge of one - see
 * {@link mergeShapes}. **HTTP metadata is not payload**, and neither is a property invisible here or
 * a `never` one, which the document drops; each is judged declaration by declaration - see
 * {@link publishedPropertiesOf}.
 */
export function objectOfModel(program: Program, model: Model): Merged {
	const shape = shapeOfModel(program, model, []);
	return shape === undefined ? NOTHING : mergeShapes(program, [shape]);
}

/**
 * **Whether a value of this type can be anything but text, so a parameter carried in text needs
 * reading** - see `wireRead`, which reads it against the schema. A type all of whose values are
 * strings is left without a reader, and its validator is the schema alone.
 *
 * A path, query or header value is always a string on the wire, so a numeric or boolean parameter has
 * to be decoded before the document's schema runs. Deciding WHETHER it is used to be done by
 * inspecting the emitted Zod - `declared.startsWith("z.number()")` - which is a string about a string
 * and fails silently the moment the expression is spelled any other way.
 *
 * It did. `@query size: 10 | 25 | 50` emits `z.union([z.literal(10), ...])`, which starts with
 * neither, so no decoder was wrapped around it and the validator required the NUMBER 25 from a wire
 * that can only deliver `"25"`. Measured: `?size=25` rejected, `size: 25` accepted. Every conformant
 * caller got a 400, and no document comparison could see it, because both sides agree the parameter
 * is a number - the disagreement is with the wire.
 *
 * Reading the TYPE answers the question the emitted text was standing in for. `SCALARS` remains the
 * single list of what becomes a number. **And WHICH reading is the value's is the schema's to say**,
 * not a kind read from the type: a kind could not say `int32 | boolean`, a numeric enum, or
 * `int32 | "all"`, and each refused a value the document accepts.
 *
 * **It still inspects the emitted expression to decide whether a scalar is numeric, and that did
 * drift once more.**
 * The test was `startsWith("z.number()")`, and giving each integer width its declared bounds spelled
 * nine of them `z.int(`, `z.int32(` and `z.uint32(` instead. Every one silently lost its wire
 * decoder: 22 arms went red at once, which is the only reason it was not shipped. The prefixes live
 * in one named constant now.
 *
 * **That claim named a `scalars.test.ts` which did not exist, and nothing graded the list.**
 * Measured: dropping `z.uint32(` from it, and separately `z.int(`, left all 468 arms in this
 * package green, because no fixture had ever declared an integer width as a PARAMETER - the only
 * place the decoder is attached. `test/widths/` now declares all ten as query parameters and sends
 * each as text, so a spelling this list forgets fails here rather than after a release.
 */
/**
 * Every emitted expression that denotes a JSON number. Named once, because `SCALARS` and this list
 * have to agree and nothing about the two being in the same file makes them.
 */
const NUMERIC_EXPRESSIONS = ["z.number()", "z.int(", "z.int32(", "z.uint32("] as const;

export function readsFromText(program: Program, type: Type): boolean {
	switch (type.kind) {
		case "Scalar": {
			// Its own encoding or an inherited one - see `scalarEncodingOf`.
			const encoded = scalarEncodingOf(program, type)?.encoded;
			// A scalar that is not standard states no type, and the schema walk refuses it.
			if (encoded !== undefined && !program.checker.isStdType(encoded)) return false;
			if (encoded !== undefined) return readsFromText(program, encoded);
			for (
				let current: Scalar | undefined = type;
				current !== undefined;
				current = current.baseScalar
			) {
				const mapped = standardScalarSchemaOf(program, current);
				if (mapped === undefined) continue;
				return (
					NUMERIC_EXPRESSIONS.some((prefix) => mapped.startsWith(prefix)) ||
					mapped === "z.boolean()"
				);
			}
			// A scalar with no standard base is any value, which text can spell as a number.
			return isTypelessMember(program, type);
		}
		/**
		 * **A value of any type is read from text as one too**: `@maxLength(2) a?: string | unknown`
		 * sent `?a=12345` is the number the document reads, which no `maxLength` constrains. Left as
		 * text, it was refused as too long.
		 */
		case "Intrinsic":
			return type.name === "unknown";
		// A literal is its own type, and a union of them is the enum form a parameter commonly takes.
		case "Number":
		case "Boolean":
			return true;
		case "EnumMember":
			return typeof type.value === "number";
		case "Enum":
			return [...type.members.values()].some((member) => typeof member.value === "number");
		case "UnionVariant":
			return readsFromText(program, type.type);
		// Any member that is not text: `int32 | boolean`, `int32 | "all"` - see `wireRead`.
		case "Union":
			return [...type.variants.values()].some((variant) => readsFromText(program, variant.type));
		default:
			return false;
	}
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
	/**
	 * **`__proto__` is the one name a key cannot spell plainly.** In an object literal, `__proto__:`
	 * - quoted or not - sets the object's prototype rather than declaring a key, so the emitted shape
	 * had no such property: it vanished from the published JSON Schema, and under
	 * `seal-object-schemas` every body carrying it was refused as an unrecognised key. A computed
	 * key declares it, in a value and in a type alike. See `unenforceable-property-name`.
	 */
	if (name === "__proto__") return `[${literal(name)}]`;
	return /^[A-Za-z_$][\w$]*$/.test(name) ? name : literal(name);
}

/**
 * A doc string as a JSDoc comment, indented, or `""` when there is none.
 *
 * **Spec-authored text going into emitted source is the same question `objectKey` answers for a
 * property name, and it had the same two-sites-one-answer shape.** A summary was interpolated raw
 * into a `/** ... *\/` block by the server emitters built on this package. Measured:
 * `@summary("a *\/ b")` is an ordinary string literal, so the text reaches here intact, closes the
 * comment early and turns the remainder into code. `TS1131`, `TS1434`, `TS1161` - one operation
 * costing the whole file, exactly like a model named `as`.
 *
 * **The bar is idiomatic output, not merely parseable output.** Two consequences:
 *
 * - A terminator is escaped as `*\/`, which is how TypeScript itself writes one inside a comment, so
 *   the sentence survives and reads correctly. Dropping or replacing the characters would lose an
 *   author's words to a mechanical problem they cannot see from their spec.
 * - A multi-line description is rendered as a multi-line BLOCK. Interpolating the newlines into a
 *   one-line form produces a comment whose continuation lines carry no ` * `, which no formatter
 *   would emit and no reviewer would write.
 *
 * `indent` is passed rather than assumed because the two call sites sit at different depths, and a
 * comment indented differently from the member it documents is the tell that a generator wrote it.
 */
export function jsDocComment(text: string | undefined, indent: string): string {
	if (text === undefined) return "";
	const lines = text
		.replaceAll("*/", "*\\/")
		.split("\n")
		.map((line) => line.trimEnd());
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	while (lines.length > 0 && lines[0] === "") lines.shift();
	if (lines.length === 0) return "";
	const [only] = lines;
	if (lines.length === 1 && only !== undefined) return `${indent}/** ${only} */\n`;
	const body = lines
		.map((line) => (line === "" ? `${indent} *` : `${indent} * ${line}`))
		.join("\n");
	return `${indent}/**\n${body}\n${indent} */\n`;
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
export function rawPropertyKey(program: Program, property: ModelProperty): string {
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
 *   `@encode("csv") string[]`            document `string`   emitted an array
 *   `@encode(seconds, float) duration`   document `number`   emitted a string
 *   `@encode(string) int32`              document `string`   emitted a number
 *   `@encode(unixTimestamp) utcDateTime` document `integer`  emitted a string
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

/**
 * **A date-time header with no `@encode` is an RFC 7231 HTTP-date, as if it said
 * `@encode(DateTimeKnownEncoding.rfc7231)`.**
 *
 * That is TypeSpec's wire form for one, and `@typespec/openapi3` publishes it as
 * `format: http-date` from `applyEncoding`'s `isDateTimeHeader` branch, which this emitter did not
 * follow. The header fell through to the scalar's default, `z.iso.datetime({ offset: true })`, so a
 * request sending it as the document describes was refused with 400, and a handler setting it as an
 * HTTP-date failed its own response contract with 500 (issue #4). The explicit encoding already
 * emitted `z.string()`, and this is that.
 *
 * **The predicate is openapi3's: the header's own schema carries `format: date-time`.** That is
 * the standard `utcDateTime` or `offsetDateTime` itself. A declared scalar extending one is
 * published as a `$ref`, a list carries the format on its items, and `T | null` is an `anyOf`
 * under 3.1 and 3.2 - the versions this package grades against - so none of those is an HTTP-date
 * in the document, and none is here. (3.0 publishes the nullable one as `nullable: true` beside an
 * `http-date` format; the graded documents do not.)
 */
function isDateTimeHeader(program: Program, property: ModelProperty): boolean {
	const type = property.type;
	return isHeader(program, property) && type.kind === "Scalar" && isStdDateTime(program, type);
}

function isStdDateTime(program: Program, scalar: Scalar): boolean {
	const { checker } = program;
	return (
		scalar === checker.getStdType("utcDateTime") || scalar === checker.getStdType("offsetDateTime")
	);
}

/** Whether a property's value, or a scalar, is a date-time: one of the two, or built on one. */
function isDateTime(program: Program, target: ModelProperty | Scalar): boolean {
	const type = target.kind === "ModelProperty" ? encodingTargetOf(target.type) : target;
	for (
		let current = type.kind === "Scalar" ? type : undefined;
		current !== undefined;
		current = current.baseScalar
	) {
		if (isStdDateTime(program, current)) return true;
	}
	return false;
}

/**
 * The type a property's `@encode` lands on in the document: the one member beside `null` where
 * openapi3 applies it there, and the declared type otherwise - see `encodedBesideNullOf`. A named
 * `union MaybeTime { utcDateTime, null }` is a `$ref`, so `rfc3339` on it publishes `type: string`
 * over the whole union and refuses `null`; read through the `null`, it was "no change", and `null`
 * was accepted.
 */
function encodingTargetOf(type: Type): Type {
	const beside = encodedBesideNullOf(type);
	return beside?.length === 1 && beside[0] !== undefined ? beside[0] : type;
}

/** Whether a property's value, or a scalar, is a `duration`, or built on one. */
function isDuration(program: Program, target: ModelProperty | Scalar): boolean {
	const type = target.kind === "ModelProperty" ? encodingTargetOf(target.type) : target;
	for (
		let current = type.kind === "Scalar" ? type : undefined;
		current !== undefined;
		current = current.baseScalar
	) {
		if (current === program.checker.getStdType("duration")) return true;
	}
	return false;
}

/**
 * The JSON type a value is published as before its own `@encode` replaces it: a property's declared
 * scalar, or the base a scalar is built from. `undefined` where it is not a scalar.
 */
function typeBeforeEncoding(
	program: Program,
	target: ModelProperty | Scalar,
): JsonType | undefined {
	const type = target.kind === "ModelProperty" ? encodingTargetOf(target.type) : target.baseScalar;
	return type?.kind === "Scalar" ? jsonTypeOfScalar(program, type) : undefined;
}

export function encodedTypeOf(
	program: Program,
	target: ModelProperty | Scalar,
): Scalar | undefined {
	const encoded = getEncode(program, target);
	if (encoded === undefined) {
		return target.kind === "ModelProperty" && isDateTimeHeader(program, target)
			? program.checker.getStdType("string")
			: undefined;
	}
	/**
	 * **`rfc3339` on a date-time is the form it already has, so it changes nothing.** openapi3's
	 * `mergeFormatAndEncoding` keeps `format: date-time` for it, and the type it reports, `string`,
	 * emitted `z.string()`: the explicit spelling of the default dropped the date-time check the
	 * document still states. Only the encodings that change the wire form - `rfc7231`,
	 * `unixTimestamp` - change the type.
	 *
	 * **Only where the value already IS that string.** `@encode(rfc3339) at: Ts`, with `Ts` a
	 * date-time `@encode`d as an integer, publishes `{ $ref: Ts, type: "string" }`, which no value
	 * satisfies; read as "no change" it validated `Ts`'s integer and contradicted the document. The
	 * same holds for `ISO8601` on a duration, the form `duration` already has.
	 */
	const before = typeBeforeEncoding(program, target);
	const unchanged =
		(encoded.encoding === "rfc3339" && isDateTime(program, target)) ||
		(encoded.encoding === "ISO8601" && isDuration(program, target));
	if (unchanged && before === "string") return undefined;
	if (
		target.kind === "ModelProperty" &&
		isQueryParam(program, target) &&
		PARAMETER_STYLE_ENCODINGS.has(encoded.encoding ?? "")
	) {
		return undefined;
	}
	return encoded.type;
}

/**
 * **What a property under `@encode` must be: what `@typespec/openapi3` publishes for it.**
 *
 * Its `applyEncoding` takes the schema the property would publish - a `$ref` to a declared type, or
 * the type written out inline - and replaces only its `type` with the encoded scalar's, dropping
 * `items` unless that is an array. Everything else stays. So `@encode("x", string) color: Color` is
 * `{ $ref: Color, type: "string" }`: a string, and one of `Color`'s values. This emitter replaced the
 * type outright, so it validated `z.string()` beside that and accepted `"green"`; it dropped a named
 * scalar's `@pattern`, a literal union's values, and the `null` of a nullable property, the last
 * contradicting the comment that said it was kept.
 *
 * - `declared`: no type change - no `@encode`, a query parameter's array style, `rfc3339` on a
 *   date-time.
 * - `replaced`: the declared type is written out inline, and nothing it kept constrains a value of
 *   the new type - a standard scalar, an inline list, record or object.
 * - `both`: the declared type is kept beside the new one and still constrains it. `kept` is what is
 *   left of it once the new `type` has ruled out every member of another JSON type - the whole
 *   declared type where nothing was ruled out - and `within` where that alone says both.
 * - `unsatisfiable`: no value is both - `{ $ref: Filter, type: "string" }` - or only `null` is, or
 *   the encoded scalar is not standard, so the document states no type at all. Refused, so no
 *   validator contradicts it.
 *
 * `nullable` is the document's: openapi3 3.1 applies the encoding to the one member beside `null`
 * when the property publishes as `anyOf: [<member>, { type: "null" }]`, and to the whole `anyOf`
 * otherwise, where the new `type` rules `null` out with everything else of another type.
 */
export type EncodedValue =
	| { readonly kind: "declared" }
	| { readonly kind: "replaced"; readonly scalar: Scalar; readonly nullable: boolean }
	| {
			readonly kind: "both";
			readonly scalar: Scalar;
			/** The encoding's name - `rfc7231`, `ISO8601` - which decides what a member's check is. */
			readonly form: string | undefined;
			readonly nullable: boolean;
			readonly kept: Type | readonly Type[];
			readonly within: boolean;
	  }
	| {
			readonly kind: "unsatisfiable";
			readonly scalar: Scalar;
			readonly declared: Type;
			readonly why: "typeless" | "nothing" | "null";
	  };

export function encodedValueOf(program: Program, property: ModelProperty): EncodedValue {
	const scalar = encodedTypeOf(program, property);
	if (scalar === undefined) return { kind: "declared" };
	const declared = property.type;
	if (!program.checker.isStdType(scalar)) {
		return { kind: "unsatisfiable", scalar, declared, why: "typeless" };
	}
	const besideNull = encodedBesideNullOf(declared);
	const nullable = besideNull !== undefined;
	const inner = besideNull ?? [declared];
	const whole = inner.length === 1 ? inner[0] : undefined;
	if (whole !== undefined && !keepsDeclaredType(program, whole)) {
		return { kind: "replaced", scalar, nullable };
	}
	// A standard scalar always has a JSON type.
	const target = jsonTypeOfScalar(program, scalar) ?? "string";
	const members = whole === undefined ? inner : membersOf(whole);
	const kept = members.filter((member) => admits(program, member, target));
	if (kept.length === 0) {
		return { kind: "unsatisfiable", scalar, declared, why: nullable ? "null" : "nothing" };
	}
	return {
		kind: "both",
		scalar,
		form: getEncode(program, property)?.encoding,
		nullable,
		/**
		 * The declared type whole where nothing was ruled out and it holds no scalar of its own -
		 * so a named enum or union of literals is still referenced - and its members otherwise, so a
		 * member scalar can be read the way `keptMemberToZod` reads it.
		 */
		kept:
			whole !== undefined &&
			kept.length === members.length &&
			(whole.kind === "Scalar" || !members.some((member) => member.kind === "Scalar"))
				? whole
				: kept,
		within: kept.every((member) => isWithin(program, member, target)),
	};
}

/**
 * **The members beside `null` that openapi3 3.1 applies an encoding to, where it applies it to them
 * rather than to the whole union.**
 *
 * Its `applyEncoding` takes that path only for an `anyOf` of exactly two members, one of them
 * `{ type: "null" }`. The members are what it PUBLISHES, not the variants written: literals of one
 * kind are merged into a single `enum`, so `"a" | "b" | null` is two members and `null` survives the
 * encoding, while `"a" | 1 | null` is three and the encoded `type` refuses `null`. A named union is
 * published as a `$ref`, never as that `anyOf`. Read off the variants, `"a" | "b" | null` refused the
 * `null` the document allows.
 */
function encodedBesideNullOf(type: Type): readonly Type[] | undefined {
	if (type.kind !== "Union" || isPublishedAsReference(type)) return undefined;
	const variants = [...type.variants.values()].map((variant) => variant.type);
	const isNull = (each: Type): boolean => each.kind === "Intrinsic" && each.name === "null";
	const nulls = variants.filter(isNull).length;
	if (nulls !== 1) return undefined;
	const rest = variants.filter((each) => !isNull(each));
	const isLiteral = (each: Type): boolean =>
		each.kind === "String" || each.kind === "Number" || each.kind === "Boolean";
	// Each `null` is a member of its own: `"a" | null | null` publishes three, and the encoding lands
	// on the whole `anyOf`.
	const published =
		new Set(rest.filter(isLiteral).map((each) => each.kind)).size +
		rest.filter((each) => !isLiteral(each)).length;
	return published === 1 ? rest : undefined;
}

/**
 * **Whether openapi3 publishes a union as a `$ref` to a component, rather than inline.**
 *
 * A named union is a component; an anonymous one is written out where it is used. A union template
 * instance is a component only where every argument has a name of its own to build the component's
 * name from - `Opt<int32>` is `OptInt32` - and is written out inline otherwise, as `Opt<"a">` is:
 * the emitter that names declarations calls such an instance "unspeakable". Read as a `$ref`, the
 * `null` that `Opt<"a">` publishes beside `"a"` was refused.
 */
function isPublishedAsReference(union: Union): boolean {
	if (union.name === undefined || union.name === "") return false;
	return union.templateMapper === undefined || union.templateMapper.args.every(isSpeakable);
}

/** Whether a template argument has a declaration name openapi3 can build a component name from. */
function isSpeakable(argument: unknown): boolean {
	const type = (
		(argument as { entityKind?: string }).entityKind === "Indeterminate"
			? (argument as { type: unknown }).type
			: argument
	) as Type;
	if (type === undefined || !("kind" in type)) return false;
	switch (type.kind) {
		case "Model":
		case "Scalar":
		case "Interface":
		case "Operation":
		case "Enum":
		case "Union":
		case "Intrinsic":
			if (!("name" in type) || type.name === undefined || type.name === "") return false;
			return (
				!("templateMapper" in type) ||
				type.templateMapper === undefined ||
				type.templateMapper.args.every(isSpeakable)
			);
		default:
			return false;
	}
}

/**
 * Whether openapi3 keeps the declared type's schema beside an encoding in a way that still
 * constrains the value: a `$ref` to anything it declares - a model, an enum, a named union, a scalar
 * outside the standard library - or an inline union or literal, whose `anyOf` or `enum` stays.
 *
 * **Declared means what `@typespec/openapi` says is declared**, through its own `shouldInline`. An
 * inline list, record or object - `{ ...Filter }` among them, which has no name of its own - keeps
 * only keywords a scalar is not checked against. This read the emitter's own naming, which names a
 * spread after the model spread into it, and refused `{ ...Filter }` as unsatisfiable while the
 * document publishes it inline and accepts any string.
 */
function keepsDeclaredType(program: Program, declared: Type): boolean {
	switch (declared.kind) {
		case "Enum":
		case "EnumMember":
		case "Union":
		case "String":
		case "Number":
		case "Boolean":
			return true;
		case "Scalar":
		case "Model":
			return !shouldInline(program, declared);
		default:
			return false;
	}
}

/** A declared type as the members its schema lists: a union's variants, an enum's members. */
/**
 * **A union's members, a nested union spelled out only where it combines as the union does** -
 * `anyOf` inside `anyOf`, `oneOf` inside `oneOf`. A nested union of the other kind is one member,
 * whole: `@oneOf` over `int32 | float` and a `string` is exactly one of two, where spelled out it was
 * exactly one of three and an integer, both an `int32` and a `float`, was none; and a `@oneOf` inside
 * a plain union, spelled out, admitted the value two of its members accept.
 */
function alikeMembersOf(
	program: Program,
	type: Type,
	exclusive = isExclusive(program, type),
): readonly Type[] {
	if (type.kind === "UnionVariant") return alikeMembersOf(program, type.type, exclusive);
	if (type.kind === "Enum") return [...type.members.values()];
	if (type.kind !== "Union") return [type];
	/**
	 * **A nested union is one member unless both sides are `anyOf`**: `anyOf(anyOf(a, b), c)` is
	 * `anyOf(a, b, c)`, but `oneOf(oneOf(a, b), c)` is not `oneOf(a, b, c)` - `1` matches both of
	 * `int32 | float` and so fails the inner union, and is valid by `c` alone. Spelled out, `1` was
	 * refused where the document accepts it.
	 */
	const members = [...type.variants.values()].flatMap((variant) => {
		const member = variant.type;
		return member.kind === "Union" && (exclusive || isPublishedOneOf(program, member))
			? [member]
			: alikeMembersOf(program, member, exclusive);
	});
	return exclusive ? withoutRepeatedLiterals(members) : members;
}

/**
 * **A literal repeated in a `@oneOf` is one member**, as openapi3 publishes every literal of one
 * JSON kind as one `enum`: `@oneOf union D { a: 1, b: 1, c: string }` is
 * `oneOf: [{ enum: [1, 1] }, { type: string }]`, which `1` matches once. Each its own member, `1`
 * matched two, and was refused.
 */
function withoutRepeatedLiterals<T extends Member>(members: readonly T[]): T[] {
	const seen = new Set<string>();
	return members.filter((member) => {
		const value =
			isEnvelope(member) || member.kind === "EnumMember" ? undefined : literalValueOf(member);
		if (value === undefined) return true;
		const key = `${typeof value}\u0000${String(value)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Whether `null` is a value of a type: a member, once under `@oneOf`, or a member with no type. */
function admitsNullValue(
	program: Program,
	type: Type,
	exclusive: boolean = isExclusive(program, type),
): boolean {
	if (type.kind === "UnionVariant") return admitsNullValue(program, type.type);
	if (isNull(type) || isTypelessMember(program, type)) return true;
	if (type.kind !== "Union") return false;
	const matches = alikeMembersOf(program, type, exclusive).filter((member) =>
		admitsNullValue(program, member),
	).length;
	return exclusive ? matches === 1 : matches > 0;
}

function membersOf(type: Type): readonly Type[] {
	// `DogKind.Golden` names a variant of a union, and stands for its type.
	if (type.kind === "UnionVariant") return membersOf(type.type);
	if (type.kind === "Union") return [...type.variants.values()].flatMap((v) => membersOf(v.type));
	if (type.kind === "Enum") return [...type.members.values()];
	return [type];
}

/**
 * The JSON type a value is published as. `fraction` is a number literal that is not an integer: a
 * `number` scalar may hold an integer, so an `integer` encoding admits it, but `1.5` never can.
 */
type JsonType =
	| "string"
	| "integer"
	| "number"
	| "fraction"
	| "boolean"
	| "object"
	| "array"
	| "null";

/** Whether a member of the declared type has a value of the encoded scalar's JSON type. */
function admits(program: Program, member: Type, target: JsonType): boolean {
	const types = jsonTypesOf(program, member);
	if (types === undefined) return true;
	return [...types].some(
		(type) =>
			type === target ||
			(target === "integer" && type === "number") ||
			(target === "number" && (type === "integer" || type === "fraction")),
	);
}

/** Whether every value of a member is of the encoded scalar's JSON type, so it alone says both. */
function isWithin(program: Program, member: Type, target: JsonType): boolean {
	const types = jsonTypesOf(program, member);
	if (types === undefined) return false;
	return [...types].every(
		(type) =>
			type === target || (target === "number" && (type === "integer" || type === "fraction")),
	);
}

const INTEGER_SCALARS = [
	"integer",
	"int8",
	"int16",
	"int32",
	"int64",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"safeint",
] as const;
const NUMBER_SCALARS = ["numeric", "float", "float32", "float64", "decimal", "decimal128"] as const;

/**
 * The JSON type a scalar is published as, its own scalar-level `@encode` included - or `undefined`
 * for a scalar with no standard base, which openapi3 publishes as `{}`, any value. Read as a string,
 * `@encode("x", int32)` on one was refused as unsatisfiable while the document accepts `5`.
 */
export function jsonTypeOfScalar(program: Program, scalar: Scalar): JsonType | undefined {
	const { checker } = program;
	for (
		let current: Scalar | undefined = scalar;
		current !== undefined;
		current = current.baseScalar
	) {
		const encoded = encodedTypeOf(program, current);
		if (encoded !== undefined && encoded !== current && checker.isStdType(encoded)) {
			return jsonTypeOfScalar(program, encoded);
		}
		const link = current;
		if (INTEGER_SCALARS.some((name) => link === checker.getStdType(name))) return "integer";
		if (NUMBER_SCALARS.some((name) => link === checker.getStdType(name))) return "number";
		if (link === checker.getStdType("boolean")) return "boolean";
		if (checker.isStdType(link)) return "string";
	}
	return undefined;
}

/** The JSON types a declared type admits, or `undefined` where it admits any. */
function jsonTypesOf(program: Program, type: Type): ReadonlySet<JsonType> | undefined {
	const numeric = (value: number): JsonType => (Number.isInteger(value) ? "integer" : "fraction");
	switch (type.kind) {
		case "Scalar": {
			const json = jsonTypeOfScalar(program, type);
			return json === undefined ? undefined : new Set([json]);
		}
		case "String":
			return new Set(["string"]);
		case "Number":
			return new Set([numeric(type.value)]);
		case "Boolean":
			return new Set(["boolean"]);
		case "EnumMember":
			return new Set([typeof type.value === "number" ? numeric(type.value) : "string"]);
		case "Enum":
		case "Union": {
			const types = new Set<JsonType>();
			for (const member of membersOf(type)) {
				const memberTypes = jsonTypesOf(program, member);
				if (memberTypes === undefined) return undefined;
				for (const each of memberTypes) types.add(each);
			}
			return types;
		}
		case "Tuple":
			return new Set(["array"]);
		case "Model":
			return new Set([type.indexer?.key.name === "integer" ? "array" : "object"]);
		case "Intrinsic":
			return type.name === "null" ? new Set(["null"]) : undefined;
		default:
			return undefined;
	}
}

/** `unsatisfiable-encoding`, once per declaration however many positions render it. */
function reportUnsatisfiableEncoding(
	program: Program,
	target: ModelProperty | Scalar,
	format: {
		name: string;
		declared: string;
		encoded: string;
		why: "typeless" | "nothing" | "null";
	},
): void {
	if (
		!firstReportOf(
			program,
			"unsatisfiable-encoding",
			target,
			`${format.declared} ${format.encoded}`,
		)
	) {
		return;
	}
	const why = {
		typeless: `'${format.encoded}' is not a standard scalar, so '@typespec/openapi3' publishes no type for it and the document accepts any value`,
		nothing:
			"'@typespec/openapi3' keeps the declared type beside the encoded one, and no value is both, so the document accepts nothing",
		null: "'@typespec/openapi3' keeps the declared type beside the encoded one, and no value but null is both, so the document accepts only null",
	}[format.why];
	reportDiagnostic(program, {
		code: "unsatisfiable-encoding",
		target,
		format: { name: format.name, declared: format.declared, encoded: format.encoded, why },
	});
}

/** A type's name for a message: its own where it has one, else its spelling. */
function nameOfType(type: Type): string {
	return "name" in type && typeof type.name === "string" && type.name !== ""
		? type.name
		: getTypeName(type);
}

/**
 * **Whether an encoded value is written as the encoded scalar intersected with what it keeps.**
 *
 * Where the kept type alone says both it is written alone - but a constraint on the property cannot
 * go on a kept union or literal, which carries no `.min` or `.regex`, so then the constraints go on
 * the encoded scalar and the kept type is intersected beside it. Applied to the union,
 * `@encode("x", string) @minLength(2) v: string | "a"` emitted `z.union(...).min(2)`, and the module
 * threw on import.
 */
export function encodedIntersects(
	program: Program,
	property: ModelProperty,
	encoding: Extract<EncodedValue, { kind: "both" }>,
): boolean {
	if (!encoding.within) return true;
	const kept = encoding.kept;
	const scalar = !Array.isArray(kept) && (kept as Type).kind === "Scalar";
	return hasConstraints(program, property) && !scalar;
}

/**
 * **A union property's constraints, applied to each member as JSON Schema applies them.**
 *
 * `@minLength(2) v: string | "a" | int32` is published `{ anyOf: [...], minLength: 2 }`, and
 * `minLength` constrains a value only where it is a string: `"ab"` and `5` are valid, `"a"` is not.
 * Each member takes the keywords of its own JSON type, and a literal member breaking one is no value
 * at all. Applied to the union, this emitted `z.union(...).min(2)`, and the module threw on import.
 * The constraints are the property's own and those of every declaration above it the position
 * leaves - see `PropertyPosition` - and, where openapi3 adds the discriminator as a `string`, only
 * the members that can be a string are left. Returns the members left, or `undefined` where the
 * property is not a union read member by member.
 */
export function constrainedMembersOf(
	program: Program,
	property: ModelProperty,
	position: PropertyPosition = OWN_POSITION,
): readonly Type[] | undefined {
	const declared = nullableInnerOf(property.type) ?? property.type;
	const sources = [property, ...position.constrainedBy];
	const constrained = sources.some((source) => hasConstraints(program, source));
	const typeless = isTypelessMember(program, declared);
	/**
	 * A value with no type of its own, constrained or narrowed to a string, is read as its kinds. An
	 * enum a keyword constrains is read as its members, as a union of literals is: `e: Color` under a
	 * declaration's `@maxLength(3)` keeps `red`, where the keyword applied to the enum's schema was
	 * `colorSchema.max(3)`, and the module threw on import.
	 */
	const members = declared.kind === "Union" || (declared.kind === "Enum" && constrained);
	if (!members && !(typeless && (position.stringOnly || constrained))) {
		return undefined;
	}
	// A `null` a declaration above refuses is no member.
	const dropsNull = position.nonNull && hasNull(declared);
	if (declared.kind === "Union" && !constrained && !position.stringOnly && !dropsNull) {
		return undefined;
	}
	const string = program.checker.getStdType("string");
	const exclusive = isExclusive(program, declared) || isExclusive(program, property);
	return (
		alikeMembersOf(program, declared, exclusive)
			.flatMap((member) => {
				if (!position.nonNull) return [member];
				const kept = withoutNull(program, member);
				return kept === undefined ? [] : [kept];
			})
			.map((member) => (position.stringOnly && isTypelessMember(program, member) ? string : member))
			.filter((member) => !position.stringOnly || admits(program, member, "string"))
			/**
			 * A literal a declaration above refuses is no member: by its keywords, or by the check its
			 * declared scalar emits. Each member is then exactly its values the position admits, so a
			 * `@oneOf` counts a value as before: `@oneOf union O1 { Color, string }` under `k: utcDateTime`
			 * kept `"red"`, matched by no other narrowed member, where the document finds it in two.
			 */
			.filter((member) => {
				const value = literalValueOf(member);
				return (
					value === undefined ||
					sources.every(
						(source) =>
							brokenConstraintOf(program, source, value) === undefined &&
							(source.kind !== "Scalar" || scalarAccepts(program, source, value) !== false),
					)
				);
			})
	);
}

/**
 * **A member without its `null`, where a declaration above refuses `null`**, or `undefined` where
 * nothing is left. A `@oneOf` keeps a nested union whole - see `alikeMembersOf` - so the `null` of
 * `@oneOf union O8 { v0: "x" | null, v1: "y" }` sat inside a member, and under `c: string` the
 * value accepted the `null` the document refuses. Taken out of the member it is sound: a value other
 * than `null` matches each member exactly as before, so a `@oneOf` counts it the same.
 */
function withoutNull(program: Program, member: Type): Type | undefined {
	const type = member.kind === "UnionVariant" ? member.type : member;
	if (isNull(type)) return undefined;
	if (type.kind !== "Union" || !hasNull(type)) return member;
	const kept = [...type.variants.values()].flatMap((variant) => {
		const each = withoutNull(program, variant.type);
		return each === undefined ? [] : [each];
	});
	if (kept.length <= 1) return kept[0];
	const union = $(program).union.create(kept);
	if (isExclusive(program, type)) exclusiveWithoutNull.add(union);
	return union;
}

/** The unions {@link withoutNull} builds from a `@oneOf`, which stay exclusive without the decorator. */
const exclusiveWithoutNull = new WeakSet<Type>();

/** A member with no JSON type of its own: `unknown`, or a scalar with no standard base. */
export function isTypelessMember(program: Program, member: Type): boolean {
	if (member.kind === "Intrinsic") return member.name === "unknown";
	return member.kind === "Scalar" && jsonTypeOfScalar(program, member) === undefined;
}

/**
 * **Any JSON value, kind by kind** - what a member with no type is, where a keyword constrains the
 * kinds it applies to: `@minLength(2) v: string | unknown` refuses `"a"`, which `unknown` alone
 * accepted. TypeScript states the same union.
 */
const ANY_JSON: readonly (readonly [zod: string, json: string, ts: string])[] = [
	["z.string()", "string", "string"],
	["z.number()", "number", "number"],
	["z.boolean()", "boolean", "boolean"],
	["z.null()", "null", "null"],
	["z.array(z.unknown())", "array", "unknown[]"],
	["z.record(z.string(), z.unknown())", "object", "globalThis.Record<string, unknown>"],
];

export const ANY_JSON_TS = ANY_JSON.map(([, , ts]) => ts).join(" | ");

/**
 * A value with the constraints of the declarations above it applied - see `PropertyPosition` - for
 * the value's own JSON type, as JSON Schema applies them through `allOf`.
 */
function withAncestors(
	program: Program,
	value: string,
	property: ModelProperty,
	position: PropertyPosition,
): string {
	const json = ownJsonTypeOf(program, property);
	return position.constrainedBy.reduce(
		(each, ancestor) =>
			applyConstraints(
				program,
				each,
				ancestor,
				json === undefined ? { quiet: true } : { type: json, quiet: true },
			),
		value,
	);
}

/** The JSON type of a property's own value, where one keyword family applies to it. */
function ownJsonTypeOf(program: Program, property: ModelProperty): string | undefined {
	const published = publishedJsonTypeOf(program, property);
	if (published !== undefined) return published;
	const declared = nullableInnerOf(property.type) ?? property.type;
	if (declared.kind === "Model")
		return declared.indexer?.key.name === "integer" ? "array" : "object";
	if (declared.kind === "Tuple") return "array";
	return isNull(declared) ? "null" : undefined;
}

/** `unrepresentable-override`, once per declaration and ancestor. */
function reportUnrepresentableOverride(
	program: Program,
	property: ModelProperty,
	position: PropertyPosition,
): void {
	const refused = position.refused;
	if (refused === undefined) return;
	const owner = refused.ancestor.model?.name ?? "its base";
	if (!firstReportOf(program, "unrepresentable-override", property, owner)) return;
	reportDiagnostic(program, {
		code: "unrepresentable-override",
		messageId: refused.recursive ? "recursive" : "default",
		target: property,
		format: {
			name: property.name,
			model: property.model?.name ?? "",
			base: owner,
			declared: getTypeName(refused.ancestor.type, { namespaceFilter: () => false }),
			why: refused.why,
		},
	});
}

/** A literal member's value, or `undefined` where the member is not a literal. */
function literalValueOf(type: Type): string | number | boolean | undefined {
	switch (type.kind) {
		case "String":
		case "Number":
		case "Boolean":
			return type.value;
		case "EnumMember":
			return type.value ?? type.name;
		default:
			return undefined;
	}
}

/** One member of a constrained union, with each source's keywords for its JSON type. */
function constrainedMemberToZod(
	program: Program,
	member: Type,
	sources: readonly Keyworded[],
): string {
	const constrain = (schema: string, type: string): string =>
		sources.reduce(
			(value, source) => applyConstraints(program, value, source, { type, quiet: true }),
			schema,
		);
	if (isTypelessMember(program, member)) {
		return `z.union([${ANY_JSON.map(([schema, json]) => constrain(schema, json)).join(", ")}])`;
	}
	const schema = typeToZod(program, member);
	if (literalValueOf(member) !== undefined) return schema;
	const type =
		member.kind === "Scalar"
			? jsonTypeOfScalar(program, member)
			: member.kind === "Tuple" ||
				  (member.kind === "Model" && member.indexer?.key.name === "integer")
				? "array"
				: member.kind === "Intrinsic" && member.name === "null"
					? "null"
					: member.kind === "Model"
						? "object"
						: undefined;
	return type === undefined ? schema : constrain(schema, type);
}

/**
 * What an encoded property keeps of its declared type, as Zod: the whole type where none of it was
 * ruled out, else the members of the encoded scalar's JSON type.
 *
 * **A declared scalar of the encoded scalar's JSON type keeps its keywords and not its format.**
 * openapi3 publishes `@encode(rfc7231) at: Instant` as `{ $ref: Instant, type: "string" }`, and
 * `Instant`'s own check - an ISO date-time - is the wire form the encoding replaced: an HTTP-date is
 * the value now. What the reference still asserts is `Instant`'s constraints. Validated as `Instant`,
 * every HTTP-date was refused.
 */
function keptToZod(
	program: Program,
	encoding: Extract<EncodedValue, { kind: "both" }>,
	schemaOf: (type: Type) => string,
): string {
	if (Array.isArray(encoding.kept)) {
		return membersToZod(
			program,
			encoding.kept,
			(member) => keptMemberToZod(program, encoding, member) ?? typeToZod(program, member),
		);
	}
	const kept = encoding.kept as Type;
	return keptMemberToZod(program, encoding, kept) ?? schemaOf(kept);
}

/**
 * A declared scalar of the encoded scalar's JSON type, as the encoded scalar plus the declared one's
 * constraints - or `undefined` where the member is read as itself. The encoding replaced the form the
 * scalar's own check is for, unless it IS that form: `rfc3339` on a date-time, `ISO8601` on a
 * duration.
 */
function keptMemberToZod(
	program: Program,
	encoding: Extract<EncodedValue, { kind: "both" }>,
	member: Type,
): string | undefined {
	return replacesFormOf(program, encoding, member)
		? applyConstraints(program, scalarSchemaOf(program, encoding.scalar), member)
		: undefined;
}

/** Whether a kept member is a scalar whose own check the encoding's wire form replaces. */
export function replacesFormOf(
	program: Program,
	encoding: Extract<EncodedValue, { kind: "both" }>,
	member: Type,
): member is Scalar {
	if (member.kind !== "Scalar") return false;
	if (jsonTypeOfScalar(program, member) !== jsonTypeOfScalar(program, encoding.scalar))
		return false;
	const ownForm =
		(encoding.form === "rfc3339" && isDateTime(program, member)) ||
		(encoding.form === "ISO8601" && isDuration(program, member));
	return !ownForm;
}

/** Members of a declared type, as the one schema a union of them is. */
function membersToZod(
	program: Program,
	members: readonly Type[],
	render: (member: Type) => string = (member) => typeToZod(program, member),
	exclusive = false,
): string {
	if (members.every((member) => member.kind === "String")) {
		const literals = members.map((member) => literal((member as { value: string }).value));
		return `z.enum([${literals.join(", ")}])`;
	}
	const [only] = members;
	if (members.length === 1 && only !== undefined) return render(only);
	return `${exclusive ? "z.xor" : "z.union"}([${members.map(render).join(", ")}])`;
}

/**
 * **Whether a union is published as `oneOf`, where exactly one member may accept a value.**
 * `@oneOf` is `@typespec/openapi3`'s decorator, on a union or on a property whose inline union it
 * makes `oneOf`; openapi3 publishes `anyOf` otherwise. Read by its state key, which the library mints
 * with `Symbol.for`, so this package depends on nothing it does not already. Validated as `z.union`,
 * a value two members accept was accepted where the document refuses it; `z.xor` is the exclusive
 * union.
 */
/**
 * **Whether openapi3 publishes a union as `oneOf`**: a `@oneOf`, or a `@discriminated` union, whose
 * variants it publishes as `oneOf` beside the discriminator mapping. A nested one is a member of its
 * own, whole: spread into `DN | O2`, `@discriminated union DN { a: NA, b: NB }` lost its
 * exclusivity, and under a PATCH `{}` - which both `NAUpdate` and `NBUpdate` accept, so `DNUpdate`
 * refuses - was accepted.
 */
function isPublishedOneOf(program: Program, union: Union): boolean {
	return isExclusive(program, union) || getDiscriminatedUnion(program, union)[0] !== undefined;
}

export function isExclusive(program: Program, target: Type): boolean {
	return (
		program.stateMap(Symbol.for("@typespec/openapi3.oneOf")).get(target) === true ||
		exclusiveWithoutNull.has(target)
	);
}

/** The inline union a property's `@oneOf` makes exclusive, while the property's value renders. */
let exclusiveSite: Type | undefined;

/** Whether a union is exclusive where it is rendered: its own `@oneOf`, or its property's. */
export function isExclusiveHere(program: Program, union: Union): boolean {
	return isExclusive(program, union) || exclusiveSite === union;
}

/** The inline union a property's `@oneOf` makes exclusive; a named one is a `$ref` it leaves alone. */
export function exclusiveSiteOf(
	program: Program,
	property: ModelProperty,
	declared: Type,
): Type | undefined {
	return isExclusive(program, property) && declared.kind === "Union" && !declared.name
		? declared
		: undefined;
}

/**
 * **Whether a `@oneOf` holds a member whose declaration is refused, or refers to one that is**, so
 * that it validates nothing. openapi3 still publishes the member, and counts it: `@oneOf union O {
 * a: S, b: N }` with `S` refused as `split-visibility` accepted `{"id": "i"}`, which matches both
 * members in the document and so is refused there - `z.xor` counted the refused `S` as matching
 * nothing. **A member holding a refused declaration further down is held stricter in the same way**:
 * `@oneOf { v0: M16, v1: M13 }`, with `M13`'s `c?: M14` refused, accepted `{ c: {...}, e: "red" }`,
 * which matches both in the document, as `M16` alone. Both walks ask it, so the validator and the
 * contract type are `never` together.
 */
export function holdsRefusedMember(program: Program, union: Union, exclusive: boolean): boolean {
	if (!exclusive) return false;
	return [...union.variants.values()].some(({ type }) => {
		if (type.kind !== "Model" && type.kind !== "Union") return false;
		return held.holdsRefusalAt(type, renderedVisibilityOf(program, type, visibility));
	});
}

export function withExclusiveSite<T>(site: Type | undefined, run: () => T): T {
	const previous = exclusiveSite;
	exclusiveSite = site;
	try {
		return run();
	} finally {
		exclusiveSite = previous;
	}
}

/**
 * The members of a union a value's keywords leave, or `undefined` where the type is no union: a
 * literal member breaking one is no value at all. Shared by both walks, so they list the same members.
 */
export function keptMembersOf(
	program: Program,
	type: Type,
	keywords: readonly Keyworded[],
): readonly Type[] | undefined {
	if (type.kind !== "Union" && type.kind !== "Enum") return undefined;
	return membersOf(type).filter((member) => {
		const value = literalValueOf(member);
		return (
			value === undefined ||
			keywords.every((source) => brokenConstraintOf(program, source, value) === undefined)
		);
	});
}

/** The keywords that constrain anything, of the declarations a merged value carries. */
export function constrainingKeywords(
	program: Program,
	keywords: readonly Keyworded[],
): readonly Keyworded[] {
	return keywords.filter((source) => hasConstraints(program, source));
}

/** A type with keywords on it, each applied to a member of its own JSON type. */
function typeWithKeywordsToZod(
	program: Program,
	type: Type,
	keywords: readonly Keyworded[],
): string {
	const sources = constrainingKeywords(program, keywords);
	if (sources.length === 0) return typeToZod(program, type);
	const members = keptMembersOf(program, type, sources);
	if (members === undefined) return constrainedMemberToZod(program, type, sources);
	if (members.length === 0) return UNREPRESENTABLE;
	return membersToZod(
		program,
		members,
		(member) => constrainedMemberToZod(program, member, sources),
		isExclusive(program, type),
	);
}

/** Keywords applied to a value of one JSON type; a model's are its own, read as declared. */
function applyKeywords(
	program: Program,
	expression: string,
	keywords: readonly Keyworded[],
	json: string,
): string {
	return keywords.reduce(
		(each, source) =>
			source.kind === "Model"
				? applyConstraints(program, each, source)
				: applyConstraints(program, each, source, { type: json, quiet: true }),
		expression,
	);
}

/** A merged value as Zod - see {@link Merged}. */
function mergedToZod(program: Program, value: Merged): string {
	switch (value.kind) {
		case "never":
		case "refused":
			return UNREPRESENTABLE;
		case "type": {
			const typed = (): string => typeWithKeywordsToZod(program, value.type, value.keywords);
			return value.at === undefined ? typed() : withVisibility(value.at, typed);
		}
		case "whole":
			return propertyValueToZod(program, value.property).base;
		case "nullable":
			return `${mergedToZod(program, value.inner)}.nullable()`;
		case "union": {
			const strings = value.members.map((member) =>
				member.kind === "type" && member.type.kind === "String" ? member.type.value : undefined,
			);
			// `z.enum` is one member of each value: an exclusive union matching a value twice refuses it.
			if (value.exclusive !== true && strings.every((each) => each !== undefined)) {
				return `z.enum([${strings.map((each) => literal(each as string)).join(", ")}])`;
			}
			const rendered = value.members.map((member) => mergedToZod(program, member));
			if (value.exclusive === true) return `z.xor([${rendered.join(", ")}])`;
			const kept = rendered.flatMap((text, index) =>
				rendered.indexOf(text) === index ? [index] : [],
			);
			noteWrittenMembers(program, value, kept);
			const members = kept.map((index) => rendered[index] as string);
			return members.length === 1 ? (members[0] as string) : `z.union([${members.join(", ")}])`;
		}
		case "all": {
			const [first, ...rest] = value.parts.map((part) => mergedToZod(program, part));
			return rest.reduce((each, part) => `${each}.and(${part})`, first ?? UNREPRESENTABLE);
		}
		case "array": {
			const element = (): string => mergedToZod(program, value.element);
			return applyKeywords(
				program,
				`z.array(${value.list === undefined ? element() : atItem(program, value.list, element)})`,
				value.keywords,
				"array",
			);
		}
		case "object":
			return objectToZod(program, value);
	}
}

/**
 * **The members a merged union is written with, by the validator and the contract type alike: one
 * of each text the validator writes, in an `anyOf`.** `M19 | M19` merged with `Record<M19>` was two
 * identical objects, whose two `z.input` types the wire assertion told apart from the one `Record` the
 * contract type is (`TS2344`). Each walk deduplicating by its own text disagreed the other way: `S3`
 * merged under `M1 | M2` is two objects the validator writes apart - `b` held to one `@minLength` and
 * to two - and the contract type wrote as one, and TypeScript counts a union of two such objects as
 * no object. So the validator decides, as it writes them, and the contract type writes the members
 * it kept - see {@link noteWrittenMembers}. Repeated in a `@oneOf`, a value matching both is refused,
 * so there each stays.
 */
export function membersToWrite(
	program: Program,
	value: Merged & { readonly kind: "union" },
): readonly Merged[] {
	if (value.exclusive === true) return value.members;
	const kept = writtenMembers.get(program)?.get(mergedKeyOf(value));
	return kept === undefined ? value.members : kept.map((index) => value.members[index] as Merged);
}

/** The members of each merged union the validator wrote, by the union's {@link mergedKeyOf}. */
const writtenMembers = new WeakMap<Program, Map<string, readonly number[]>>();

function noteWrittenMembers(program: Program, value: Merged, kept: readonly number[]): void {
	let byKey = writtenMembers.get(program);
	if (byKey === undefined) {
		byKey = new Map();
		writtenMembers.set(program, byKey);
	}
	byKey.set(mergedKeyOf(value), kept);
}

/**
 * **A merged value's shape as text**, the same for the same value whichever walk merged it: each
 * walk merges a position afresh, so the two values are alike and never one object. A TypeSpec type is
 * itself, by an id of its own.
 */
function mergedKeyOf(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
	if ("entityKind" in value) {
		let id = entityIds.get(value);
		if (id === undefined) {
			id = ++entityCount;
			entityIds.set(value, id);
		}
		return `#${id}`;
	}
	if (Array.isArray(value)) return `[${value.map(mergedKeyOf).join(",")}]`;
	return `{${Object.keys(value)
		.toSorted()
		.map((key) => `${JSON.stringify(key)}:${mergedKeyOf((value as Record<string, unknown>)[key])}`)
		.join(",")}}`;
}

const entityIds = new WeakMap<object, number>();
let entityCount = 0;

/**
 * An object as Zod: its members, and what it does with a key none of them names.
 *
 * Both a model and a merge of several end here, so a merged object is written by the rules a model
 * is - and a model is just the merge of one.
 */
function objectToZod(program: Program, object: MergedObject): string {
	const { rest } = object;
	const site = object.site;
	const restToZod = (value: Merged): string =>
		site === undefined
			? mergedToZod(program, value)
			: withDeclarationSite(site, () => mergedToZod(program, value));
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
	if (object.dictionary && typeof rest !== "string") {
		return applyKeywords(
			program,
			`z.record(z.string(), ${restToZod(rest)})`,
			object.keywords,
			"object",
		);
	}
	if (object.dictionary && rest === "loose") {
		return applyKeywords(program, "z.record(z.string(), z.unknown())", object.keywords, "object");
	}
	/**
	 * Permissiveness, read from the INDEXER and from nothing else.
	 *
	 * `...Record<unknown>` is the standard TypeSpec construct and the one `@typespec/openapi3` can
	 * see, so it is the only source. There was a second - `@loose`, a decorator this package
	 * declared, invisible to the document - and it is gone: a model that accepted unknown properties
	 * while the published schema said otherwise is a runtime disagreeing with its own contract.
	 *
	 * An indexer over something other than `unknown` is a typed catchall, where `.loose()` would drop
	 * that value type on the floor.
	 *
	 * **`Record<never>` is how a spec says "and nothing else", not a value type to walk** - sealed,
	 * as `@typespec/openapi3` publishes it with `additionalProperties: {not: {}}`.
	 *
	 * A request model REJECTS an unrecognised field rather than stripping it. Silently dropping
	 * something a caller sent is the same failure this whole surface exists to remove, one layer out:
	 * the request succeeds and does less than it was asked to, with nothing anywhere reporting it.
	 */
	const catchall = typeof rest === "string" ? undefined : rest;
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
	const members = object.members.map((member) => {
		const key = objectKey(member.key);
		const { property, position } = member;
		if (property === undefined) {
			const value = captureBackEdges(() => mergedToZod(program, position.value ?? NOTHING));
			// Optional where no declaration requires it - an envelope's members under a PATCH.
			const schema = position.required ? value.value : `${value.value}.exactOptional()`;
			return {
				deferred: value.deferred,
				text: value.deferred
					? `\tget ${key}() {\n\t\treturn ${schema};\n\t},`
					: `\t${key}: ${schema},`,
			};
		}
		const { value, deferred } = captureBackEdges(() =>
			withDeclarationSite(property, () =>
				atPosition(position, () =>
					atDeclaration(program, property, () => propertyToZod(program, property, position)),
				),
			),
		);
		/**
		 * **A getter without a return type infers `unknown`, and the collapse is SILENT.**
		 *
		 * The docblock above claims the getter keeps `z.infer` inferring the recursive type. It does
		 * for the declaration itself, and not for a schema that WRAPS it: measured on the conformance
		 * corpus, `z.record(z.string(), innerModelSchema)` - what `@body body: Record<InnerModel>`
		 * emits - infers `children?: unknown`, and `.parse()` on it returns `unknown` outright. The
		 * generated server then failed to compile with `TS2322`, in `type/dictionary`, which is how
		 * this was found; nothing said the emitted TYPE was weaker than the document.
		 *
		 * Annotating the GETTER rather than the declaration is what keeps `.shape` and `.extend`,
		 * which inheritance and every group spread depend on. `: z.ZodType<T, T>` names both of Zod's
		 * parameters for the reason `renderSchemas` names both: one leaves the input side `unknown`.
		 */
		const annotation = deferred
			? (atDeclaration(program, property, () => annotateDeferred(property, position)) ?? "")
			: "";
		return {
			deferred,
			text: deferred
				? `\tget ${key}()${annotation} {\n\t\treturn ${value};\n\t},`
				: `\t${key}: ${value},`,
		};
	});
	const entries = members.map((member) => member.text);
	const suffix =
		rest === "loose"
			? ".loose()"
			: catchall === undefined
				? ""
				: `.catchall(${restToZod(catchall)})`;
	const strict = rest === "sealed" ? ".strict()" : "";
	/**
	 * **A deferred property forces the CONSTRUCTOR form of the object.**
	 *
	 * Measured on Zod 4.4.3: `.strict()`, `.loose()` and `.catchall()` all read `shape` eagerly, so
	 * each one fires the getter during module initialisation and throws `Cannot access 'X' before
	 * initialization` - the very thing the getter exists to avoid. `z.strictObject` and
	 * `z.looseObject` take the same shape without reading it.
	 *
	 * **So the constructor form is used wherever it exists, not only where a cycle forces it.** It is
	 * also what Zod 4 asks for: its own types say "Consider `z.looseObject(A.shape)` instead" on
	 * `.loose()` and `.strict()`, and `.passthrough()` is deprecated outright. Emitting one spelling
	 * means a model that gains a back edge later does not silently change form, and the eager-`shape`
	 * hazard above stops being something this walk has to keep reasoning about.
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
	const body = constructible
		? `${suffix === ".loose()" ? "z.looseObject" : strict === ".strict()" ? "z.strictObject" : "z.object"}(${shape})`
		: lazily
			? `z.lazy(() => z.object(${shape})${suffix}${strict})`
			: `z.object(${shape})${suffix}${strict}`;
	/**
	 * A model-level constraint goes through the same path as every other constraint. `.refine()`
	 * returns an effect rather than an object, so applying it after `.loose()` is the only order that
	 * works.
	 */
	return applyKeywords(program, body, object.keywords, "object");
}

/**
 * A property's VALUE as Zod - its type, encoding, constraints and nullability - without its
 * optionality, its default or its description, which belong to the position.
 */
function propertyValueToZod(
	program: Program,
	property: ModelProperty,
	position: PropertyPosition = OWN_POSITION,
): { readonly base: string; readonly description: string | undefined } {
	/**
	 * **Constraints go INSIDE `.nullable()`, not after it.**
	 *
	 * `z.string().nullable().min(1)` does not compile - `.min` is not on `ZodNullable` - so a property
	 * typed `string | null` with `@minLength(1)` has to emit `z.string().min(1).nullable()`. The
	 * nullability is peeled off here, the constraints applied to what is underneath, and the wrapper
	 * put back.
	 *
	 * `.optional()` stays outermost: a constraint after it would apply to the optionality rather than
	 * to the value.
	 */
	// A `null` the 3.0 document cannot publish refuses the value - see `unpublishableNullWhy`.
	const unpublishable = unpublishableNullWhy(program, property.type);
	if (unpublishable !== undefined) {
		return {
			base: refuseUnpublishableNull(program, property.type, unpublishable),
			description: getDoc(program, property),
		};
	}
	/**
	 * `@encode` is read as `encodedValueOf` says the document publishes it, nullability included:
	 * openapi3 3.1 publishes `anyOf: [<the encoded value>, { type: "null" }]` where the encoding is
	 * applied beside `null`, and the encoded `type` rules `null` out where it is applied to the whole.
	 */
	const encoding = encodedValueOf(program, property);
	/**
	 * **A named union is its own declaration**, where nothing about the position is applied to its
	 * members: openapi3 publishes `m: MaybeN1<ItemN1>` as `$ref: MaybeN1`, and the contract types
	 * declare `MaybeN1`. Peeled to `itemN1Schema.nullable()` here, it had no validator.
	 */
	const whole =
		property.type.kind === "Union" &&
		!shouldInline(program, property.type) &&
		encoding.kind === "declared" &&
		!position.nonNull &&
		position.constrainedBy.length === 0 &&
		!hasConstraints(program, property);
	const nullable = whole ? undefined : peeledNullOf(program, property);
	if (encoding.kind === "unsatisfiable") {
		reportUnsatisfiableEncoding(program, property, {
			name: property.name,
			declared: nameOfType(encoding.declared),
			encoded: encoding.scalar.name,
			why: encoding.why,
		});
	}
	// A declaration above refusing `null` leaves the value without it - see `PropertyPosition`.
	const bare =
		position.nonNull ||
		(encoding.kind === "declared"
			? nullable === undefined
			: encoding.kind === "unsatisfiable" || !encoding.nullable);
	/** The type whose schema is the value, for the description a scalar carries. */
	const declared: Type =
		encoding.kind === "declared"
			? (nullable ?? property.type)
			: encoding.kind === "replaced"
				? encoding.scalar
				: encoding.kind === "both" && !Array.isArray(encoding.kept)
					? (encoding.kept as Type)
					: property.type;
	/**
	 * **One description per position, and a property's own doc wins over its scalar's.**
	 *
	 * openapi3 publishes `rating: Rating` as `{ $ref: Rating, description: <the property's doc> }`,
	 * and a reader takes the sibling over what the reference carries. A scalar here is inlined rather
	 * than referenced, so where the property's value IS the scalar, its schema is taken without its
	 * description and the one the position publishes is decided once: the property's doc, else the
	 * scalar's. Otherwise a documented property of a documented scalar was written
	 * `.describe(a).describe(b)`, which says the same thing in a way no one would write.
	 *
	 * Under `.nullable()` the scalar keeps its own, inside the wrapper: openapi3 publishes
	 * `anyOf: [{ $ref: Rating }, { type: "null" }]` there, so the scalar's description belongs to the
	 * branch and only the property's belongs to the property.
	 */
	const inlinedScalar = bare && declared.kind === "Scalar";
	// A property's `@oneOf` makes its INLINE union exclusive; a named one is a `$ref` it leaves alone.
	const exclusive = exclusiveSiteOf(program, property, declared);
	const schemaOf = (type: Type): string =>
		bare && type.kind === "Scalar"
			? scalarSchemaOf(program, type)
			: withExclusiveSite(exclusive, () => typeToZod(program, type));
	let constrained: string;
	switch (encoding.kind) {
		case "unsatisfiable":
			constrained = UNREPRESENTABLE;
			break;
		case "declared": {
			const sources = [property, ...position.constrainedBy];
			const members = constrainedMembersOf(program, property, position);
			constrained =
				members === undefined
					? withAncestors(
							program,
							applyConstraints(program, schemaOf(declared), property),
							property,
							position,
						)
					: members.length === 0
						? UNREPRESENTABLE
						: membersToZod(
								program,
								members,
								(member) => constrainedMemberToZod(program, member, sources),
								exclusive !== undefined || isExclusive(program, declared),
							);
			break;
		}
		case "replaced":
			constrained = withAncestors(
				program,
				applyConstraints(program, schemaOf(encoding.scalar), property),
				property,
				position,
			);
			break;
		case "both": {
			/**
			 * The property's own constraints are applied to the encoded scalar's schema, never to an
			 * intersection, which carries no `.min` or `.regex`; the kept type brings its own.
			 */
			const kept = keptToZod(program, encoding, schemaOf);
			constrained = !encodedIntersects(program, property, encoding)
				? applyConstraints(program, kept, property)
				: `${applyConstraints(program, scalarSchemaOf(program, encoding.scalar), property)}.and(${kept})`;
			break;
		}
	}
	const base = bare ? constrained : `${constrained}.nullable()`;
	const description =
		getDoc(program, property) ?? (inlinedScalar ? scalarDocOf(program, declared) : undefined);
	return { base, description };
}

export function propertyToZod(
	program: Program,
	property: ModelProperty,
	position: PropertyPosition = OWN_POSITION,
): string {
	if (position.refused !== undefined) reportUnrepresentableOverride(program, property, position);
	// Merged with the declarations above it where the value narrows none - see `mergeParts`.
	const own =
		position.value === undefined
			? atReading(program, property, () => propertyValueToZod(program, property, position))
			: { base: mergedToZod(program, position.value), description: getDoc(program, property) };
	// What the declarations above it leave of the value - see `PropertyPosition`.
	const base =
		position.never || position.refused !== undefined
			? UNREPRESENTABLE
			: position.nullOnly
				? "z.null()"
				: own.base;
	const { description } = own;
	/**
	 * **Optionality is a function of the position too, not only of the `?` in the spec.**
	 *
	 * TypeSpec's PATCH semantics make a property optional in an update request even where the model
	 * declares it required - an update sends the fields it is changing. The document says so
	 * (`VisibilityModelUpdate` requires nothing) and a validator that still demanded the property
	 * would reject every partial update the contract invites. `metadataInfo.isOptional` is the same
	 * predicate `@typespec/openapi3` uses to decide the `required` list.
	 */
	const optional = !position.required && (property.optional || isOptionalAt(program, property));
	reportInheritedName(program, property, optional);
	// A value nothing satisfies takes no default: there is no value to fall back to.
	if (refusedValue(program, property, position)) {
		return described(optional ? `${base}.exactOptional()` : base, description);
	}
	/**
	 * **A default only applies where the document says the property may be absent.**
	 *
	 * `.default(v)` makes a Zod field optional on the way IN, so emitting one for a property the
	 * document publishes as `required` made this validator accept a request the document beside it
	 * refuses. `default` is an ANNOTATION under JSON Schema 2020-12 and `required` is the assertion;
	 * `@typespec/openapi3` reads the two exactly that way, building `required` from
	 * `metadataInfo.isOptional` and never consulting a default. See `default-on-required-property`
	 * in `lib.ts` for the specification chain and for why this warns rather than refuses.
	 *
	 * Reported and then rendered as an ordinary required property - the declared shape is untouched
	 * and only the dead fallback is dropped, which is the same shape `unsupported-default` already
	 * takes. `defaultOf` is deliberately NOT called on this path: it would report a second diagnostic
	 * about a value that cannot be reached either way, naming the less useful of the two problems.
	 */
	if (!optional && property.defaultValue !== undefined) {
		// Required by its position rather than its `?`: a discriminator, or a declaration above it.
		const imposed = position.required && (property.optional || isOptionalAt(program, property));
		const discriminator =
			imposed &&
			property.model !== undefined &&
			discriminatorsOf(program, property.model).includes(rawPropertyKey(program, property));
		if (firstReportOf(program, "default-on-required-property", property)) {
			reportDiagnostic(program, {
				code: "default-on-required-property",
				messageId: discriminator ? "discriminator" : imposed ? "ancestor" : "default",
				target: property,
				format: { name: property.name },
			});
		}
		return described(base, description);
	}
	/**
	 * A TypeSpec default (`cover?: string = "paperback"`) becomes `.default(...)`, which in Zod also
	 * makes the field optional on the way in - matching a document that leaves the property out of
	 * `required` and annotates it with the value. `.optional()` is not added beside it: `.default()`
	 * already accepts an absent value, and the two together would make the OUTPUT optional as well,
	 * so the fallback could be skipped.
	 */
	const defaulted = defaultOf(program, property, position);
	if (defaulted !== undefined) {
		/**
		 * **A default no literal of the validator's type spells is the validator's own parse of it** -
		 * see {@link setsKeyItsIndexerRefuses}. The value is the same: it was held to the schema above,
		 * and a parse of a valid value is that value with its defaults filled, as the literal is.
		 */
		const value = jsonLiteral(defaulted);
		const fallback = setsKeyItsIndexerRefuses(program, property.type, defaulted)
			? `() => ${base}.parse(${value})`
			: value;
		return described(`${base}.default(${fallback})`, description);
	}
	/**
	 * **`.exactOptional()`, because the document says the KEY may be absent and nothing more.**
	 *
	 * `.optional()` additionally accepts an explicit `undefined`, and **JSON cannot carry one** - so
	 * for a body the validator was admitting a value no conformant request can contain, and for a
	 * parameter one no transport produces. The document says exactly "absent or a value" by leaving
	 * the property out of `required`, and this is the construct that says the same.
	 *
	 * **The emitted TYPE has said this since `0.17.0`; only the validator disagreed.** `Exact<>` was
	 * written to strip `| undefined` back off `z.infer`, with a docblock arguing precisely this - so
	 * one program published a type refusing `{ note: undefined }` beside a validator accepting it, and
	 * nothing compared them. `z.infer` of `.exactOptional()` is `note?: T` natively and at every depth,
	 * which a shallow mapped type never managed, so `Exact<>` is deleted rather than kept beside it.
	 *
	 * Measured on zod 4.5.2 before the change: `z.toJSONSchema` is byte-identical for the two, so the
	 * differential's serialisation axis is untouched, and `def.type` is still `"optional"`, so the
	 * shape describers read it unchanged.
	 */
	return described(optional ? `${base}.exactOptional()` : base, description);
}

/**
 * The names every JavaScript object inherits, which Zod reads in place of an absent property.
 * `__proto__` is among them and is the different case: Zod skips it outright.
 */
const INHERITED_NAMES: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype));

/** Properties already reported, by declaration: one property renders once per visibility. */
const reportedNames = new WeakMap<Program, WeakSet<object>>();

/**
 * **A wire name the validator cannot treat as an ordinary key is reported where it bites.** See
 * `unenforceable-property-name` and `optional-prototype-name` in `lib.ts` for why each is a
 * warning and what each costs.
 *
 * Reported here rather than from a walk over the program because `optional` is a fact about the
 * POSITION: a PATCH makes a required property optional, and only there does an inherited name
 * refuse its omission. Once per declaration, by its syntax node, because a visibility projection
 * hands this a different `ModelProperty` for the same one.
 */
function reportInheritedName(program: Program, property: ModelProperty, optional: boolean): void {
	const name = wireNameOf(program, property);
	if (!INHERITED_NAMES.has(name)) return;
	const unenforceable = name === "__proto__";
	if (!unenforceable && !optional) return;
	const declaration = property.node ?? property;
	let reported = reportedNames.get(program);
	if (reported === undefined) reportedNames.set(program, (reported = new WeakSet()));
	if (reported.has(declaration)) return;
	reported.add(declaration);
	if (unenforceable) {
		reportDiagnostic(program, {
			code: "unenforceable-property-name",
			target: property,
			format: { name },
		});
	} else {
		reportDiagnostic(program, {
			code: "optional-prototype-name",
			target: property,
			format: { name },
		});
	}
}

/** The key a property is validated under: its parameter name, or its name in a JSON body. */
function wireNameOf(program: Program, property: ModelProperty): string {
	if (isHeader(program, property)) return getHeaderFieldName(program, property);
	if (isQueryParam(program, property)) return getQueryParamName(program, property) ?? property.name;
	if (isPathParam(program, property)) return getPathParamName(program, property) ?? property.name;
	if (isCookieParam(program, property)) {
		return getCookieParamOptions(program, property)?.name ?? property.name;
	}
	return rawPropertyKey(program, property);
}

/**
 * **Whether `propertyToZod` emits `.default(...)` for this property, which is exactly whether its
 * INPUT admits an explicit `undefined`.**
 *
 * `.exactOptional()` refuses `{ p: undefined }`; `.default(v)` accepts it and fills `v`. The contract
 * types in `requests.gen.ts` state the input, so they have to know which of the two this emitted -
 * and asking this function rather than restating its rule is what keeps the two walks agreeing.
 * A default on a REQUIRED property emits neither (`default-on-required-property`), and one whose
 * value cannot be rendered emits no `.default()` (`unsupported-default`); both fall out here.
 *
 * Pure: it reports nothing, so the type walk can ask it without duplicating a diagnostic.
 */
export function emitsDefault(
	program: Program,
	property: ModelProperty,
	position: PropertyPosition = OWN_POSITION,
): boolean {
	const optional = !position.required && (property.optional || isOptionalAt(program, property));
	if (
		!optional ||
		property.defaultValue === undefined ||
		refusedValue(program, property, position)
	) {
		return false;
	}
	const serialized = defaultJsonOf(program, property);
	return (
		serialized !== undefined &&
		defaultClashOf(program, property, position, serialized.json) === undefined
	);
}

/**
 * Whether the value at this position validates nothing - refused, or no value of it is valid - so
 * it takes no default: there is nothing to fall back to, and `z.never().default(...)` does not
 * compile.
 */
function refusedValue(
	program: Program,
	property: ModelProperty,
	position: PropertyPosition,
): boolean {
	if (position.never || position.nullOnly || position.refused !== undefined) return true;
	if (encodedValueOf(program, property).kind === "unsatisfiable") return true;
	const declared = nullableInnerOf(property.type) ?? property.type;
	// A tuple parameter is refused as `unsupported-type`.
	return declared.kind === "Tuple" && parameterPosition;
}

/**
 * **Why a default is no value the position accepts, or `undefined` where it is one.**
 *
 * A default is written in the declared type and published as the JSON openapi3 serializes it, and
 * that is not always a value of the schema it sits beside. `@encode` can change the type under it -
 * `@encode(string) count?: int32 = 5` is `{ type: "string", default: 5 }`, and a scalar built on an
 * encoded scalar carries the encoding too; a property's constraints can rule out a union's literal
 * the default names; a key the default sets can be one the position does not publish - a read-only
 * property in a create body, a model the document only knows as a union member. Filled in, any of
 * these handed the handler a value its type says it cannot hold, and the emitted module did not
 * compile. No fallback is both the document's and a valid value, so none is emitted, and
 * `invalid-default` says why. Checked member by member through lists, records and objects.
 */
function defaultClashOf(
	program: Program,
	property: ModelProperty,
	position: PropertyPosition,
	json: unknown,
): string | undefined {
	/**
	 * **An integer past what a JSON number holds exactly is published as `null`** - `int64 = 2^53 + 1`
	 * - and was reported as though the author had written `null`.
	 */
	const written = property.defaultValue;
	if (json === null && written?.valueKind === "NumericValue") {
		return `it is ${written.value.toString()}, which no JSON number holds exactly, and openapi3 publishes it as null`;
	}
	const clash = valueClashOf(program, property, position, json);
	/**
	 * **Where openapi3 publishes fewer keys than the default sets, the message says so**: an object
	 * default on a union-typed property is serialized as `{}`, and "it leaves out 'kind'" read as
	 * though the spec had.
	 */
	if (
		clash !== undefined &&
		written?.valueKind === "ObjectValue" &&
		json !== null &&
		typeof json === "object" &&
		Object.keys(json).length < written.properties.size
	) {
		return `openapi3 publishes it as ${JSON.stringify(json)}, without keys it sets, and ${clash}`;
	}
	return clash;
}

/**
 * **Why a JSON value is no value of a property at its position, or `undefined` where it is one** -
 * asked of a default, and of each key a default sets, at that key's own position.
 */
function valueClashOf(
	program: Program,
	property: ModelProperty,
	position: PropertyPosition,
	json: unknown,
): string | undefined {
	// Every declaration above holds the value too, merged or implied - a `null` one refuses included.
	for (const ancestor of position.ancestors) {
		const clash = jsonClashOf(program, json, valueJsonTypesOf(program, ancestor), ancestor.type);
		if (clash !== undefined) return clash;
	}
	/**
	 * **The check its own scalar emits** - a width, a format - which the document publishes as
	 * `format` and JSON Schema reads as an annotation, so no keyword above says it: a `plainDate` of
	 * February 30th, a `url` that is no URL, a date past what an `int32` timestamp encodes. Each was
	 * filled in, and refused when sent back. Asked of the encoded scalar where `@encode` replaces the
	 * value's type, as the validator asks it - and first, since a keyword `@encode` moves onto a type it
	 * does not apply to is dropped: `@encode(string) @minValue(5) low?: int32 = 3` is no string, and
	 * was reported as breaking the `@minValue` the validator does not enforce.
	 */
	const declared = nullableInnerOf(property.type) ?? property.type;
	const encoding = encodedValueOf(program, property);
	const validated =
		encoding.kind === "replaced" || encoding.kind === "both"
			? encoding.scalar
			: declared.kind === "Scalar"
				? declared
				: undefined;
	if (
		validated !== undefined &&
		json !== null &&
		scalarAccepts(program, validated, json) === false
	) {
		return `it is no '${validated.name}' the validator accepts`;
	}
	/**
	 * **And every keyword on the way: the property's, each declaration's above it, and its declared
	 * scalar's.** `@minValue(10) mv?: int32 = 5` filled a `5` the same validator refuses when it is
	 * sent, and the handler was handed it.
	 */
	const broken = keywordClashOf(program, json, [
		property,
		...position.constrainedBy,
		...position.ancestors,
		...(declared.kind === "Scalar" ? [declared] : []),
	]);
	if (broken !== undefined) return `it breaks ${broken}`;
	/**
	 * **A merged value is the one schema the document holds it to**, so it is asked whole: what no
	 * declaration states is part of it - the value of a typed indexer of a model merged with this
	 * one, which holds every key that model does not name. `Root { u: B | A }` with `A` a
	 * `Record<Small>` and `Sub { u: B2 }` filled `B2`'s `k = 7` into the `A` branch, where `Small`
	 * refuses it.
	 */
	if (position.value !== undefined) {
		const clash = mergedClashOf(program, json, position.value);
		if (clash !== undefined) return clash;
	}
	const members =
		position.value === undefined ? constrainedMembersOf(program, property, position) : undefined;
	if (members !== undefined) {
		const fits =
			(json === null && hasNull(property.type)) ||
			members.some(
				(member) => jsonClashOf(program, json, jsonTypesOf(program, member), member) === undefined,
			);
		return fits ? undefined : "it is no value of the members the property's constraints leave";
	}
	return jsonClashOf(program, json, valueJsonTypesOf(program, property), property.type);
}

/** The first keyword of these declarations a JSON value breaks, for its own JSON type. */
function keywordClashOf(
	program: Program,
	json: unknown,
	sources: readonly Keyworded[],
): string | undefined {
	for (const source of sources) {
		const broken =
			typeof json === "string" || typeof json === "number"
				? brokenConstraintOf(program, source, json)
				: Array.isArray(json)
					? brokenItemsOf(program, source, json.length)
					: undefined;
		if (broken !== undefined) return broken;
	}
	return undefined;
}

/** Why a JSON value does not fit a declared type, by kind and then member by member, or `undefined`. */
function jsonClashOf(
	program: Program,
	json: unknown,
	types: ReadonlySet<JsonType> | undefined,
	type: Type,
): string | undefined {
	const kind = jsonTypeOfValue(json);
	const fits =
		types === undefined ||
		types.has(kind as JsonType) ||
		(kind === "integer" && types.has("number")) ||
		(kind === "number" && types.has("fraction"));
	if (!fits) {
		const expected = [...(types ?? [])].filter((each) => each !== "null").join(" or ");
		return `it is a JSON ${kind}, and the value is a JSON ${expected}`;
	}
	const declared = nullableInnerOf(type) ?? type;
	/**
	 * **A literal admits its own value and no other, and an enum or a union of literals its members'.**
	 * Read by JSON type alone, a default a literal above refuses was filled in: `Leaf { kk?: string =
	 * "abcd" }` named `k` with `@encodedName` over `Root { k?: "b" }`, which the compiler does not hold
	 * `kk` to, and `M14 { a?: string = "a" }` merged into `Record<Color.red>`, were emitted as
	 * `z.literal("b").default("abcd")`, refused when sent back, and the module failed to typecheck.
	 */
	const fixed = literalValuesOfType(declared);
	if (
		fixed !== undefined &&
		(typeof json === "string" || typeof json === "number" || typeof json === "boolean") &&
		!admitsValue(program, declared, json)
	) {
		return `it is ${JSON.stringify(json)}, and the value is ${fixed.map((value) => JSON.stringify(value)).join(" or ")}`;
	}
	// A declared scalar's keywords, and a named list model's, hold at every depth.
	if (declared.kind === "Scalar" || declared.kind === "Model") {
		const broken = keywordClashOf(program, json, [declared]);
		if (broken !== undefined) return `it breaks ${broken}`;
	}
	if (declared.kind === "Union" && kind !== "null") {
		const members = membersOf(declared).filter((member) => !isNull(member));
		const clashes = members.map((member) =>
			jsonClashOf(program, json, jsonTypesOf(program, member), member),
		);
		return clashes.includes(undefined) ? undefined : clashes[0];
	}
	if (declared.kind !== "Model") return undefined;
	const element = declared.indexer?.key.name === "integer" ? declared.indexer.value : undefined;
	if (Array.isArray(json) && element !== undefined) {
		for (const item of json) {
			const clash = jsonClashOf(program, item, jsonTypesOf(program, element), element);
			if (clash !== undefined) return clash;
		}
		return undefined;
	}
	if (kind !== "object") return undefined;
	const entries = Object.entries(json as object);
	// A record of values, each checked as its value type.
	if (declared.indexer?.key.name === "string" && declared.properties.size === 0) {
		const value = declared.indexer.value;
		for (const [, each] of entries) {
			const clash = jsonClashOf(program, each, jsonTypesOf(program, value), value);
			if (clash !== undefined) return clash;
		}
		return undefined;
	}
	/**
	 * **Each key at its own position, the declarations above it included**, read where the model is
	 * rendered. Held to its own declaration alone, `o?: KS = #{ k: "toolong" }` was filled in where
	 * `KS extends KB` and `KB` declares `@maxLength(3) k`: `KS`'s `allOf` refuses it.
	 */
	return withVisibility(renderedVisibilityOf(program, declared, visibility), () => {
		const published = publishedPropertiesOf(program, declared).map((entry) => ({
			entry,
			key: rawPropertyKey(program, entry.property),
			position: positionOf(program, declared, entry),
		}));
		for (const [key, value] of entries) {
			const each = published.find((candidate) => candidate.key === key);
			if (each === undefined) {
				if (declared.indexer === undefined && isSealed(declared))
					return `it sets '${key}', which the value does not declare here`;
				continue;
			}
			const clash = valueClashOf(program, each.entry.property, each.position, value);
			if (clash !== undefined) return `at '${key}', ${clash}`;
		}
		const missing = published.find(
			({ entry, key, position }) =>
				(position.required ||
					!(entry.property.optional || isOptionalAt(program, entry.property))) &&
				!entries.some(([sent]) => sent === key),
		);
		return missing === undefined ? undefined : `it leaves out '${missing.key}', which is required`;
	});
}

/**
 * **Why a JSON value is no value of a merged schema**, read as the validator it renders reads it -
 * see {@link Merged}. A refusal is reported where it is found, so it clashes with nothing here.
 */
function mergedClashOf(program: Program, json: unknown, merged: Merged): string | undefined {
	const kind = jsonTypeOfValue(json);
	switch (merged.kind) {
		case "never":
			return "no value is valid where it is filled in";
		case "refused":
			return undefined;
		case "type": {
			const clash = withVisibility(merged.at ?? visibility, () =>
				jsonClashOf(program, json, jsonTypesOf(program, merged.type), merged.type),
			);
			if (clash !== undefined) return clash;
			const broken = keywordClashOf(program, json, merged.keywords);
			return broken === undefined ? undefined : `it breaks ${broken}`;
		}
		case "whole":
			return valueClashOf(program, merged.property, OWN_POSITION, json);
		case "nullable":
			return json === null ? undefined : mergedClashOf(program, json, merged.inner);
		case "all":
			for (const part of merged.parts) {
				const clash = mergedClashOf(program, json, part);
				if (clash !== undefined) return clash;
			}
			return undefined;
		case "union": {
			const clashes = merged.members.map((member) => mergedClashOf(program, json, member));
			const fits = clashes.filter((clash) => clash === undefined).length;
			if (merged.exclusive === true ? fits === 1 : fits > 0) return undefined;
			return fits > 1
				? "it is a value of more than one member of a '@oneOf' union"
				: (clashes[0] ?? "it is no value of the union");
		}
		case "array": {
			if (!Array.isArray(json)) return `it is a JSON ${kind}, and the value is a JSON array`;
			const broken = keywordClashOf(program, json, merged.keywords);
			if (broken !== undefined) return `it breaks ${broken}`;
			for (const item of json) {
				const clash = mergedClashOf(program, item, merged.element);
				if (clash !== undefined) return clash;
			}
			return undefined;
		}
		case "object": {
			if (kind !== "object") return `it is a JSON ${kind}, and the value is a JSON object`;
			const entries = Object.entries(json as object);
			for (const [key, value] of entries) {
				const member = merged.members.find((each) => each.key === key);
				if (member === undefined) {
					if (merged.rest === "sealed") {
						return `it sets '${key}', which the value does not declare here`;
					}
					const clash =
						typeof merged.rest === "string"
							? undefined
							: mergedClashOf(program, value, merged.rest);
					if (clash !== undefined) return `at '${key}', ${clash}`;
					continue;
				}
				const clash =
					member.property === undefined
						? member.position.value === undefined
							? undefined
							: mergedClashOf(program, value, member.position.value)
						: valueClashOf(program, member.property, member.position, value);
				if (clash !== undefined) return `at '${key}', ${clash}`;
			}
			// A merged member's position says whether any declaration of the key requires it.
			const missing = merged.members.find(
				(member) => member.position.required && !entries.some(([sent]) => sent === member.key),
			);
			return missing === undefined
				? undefined
				: `it leaves out '${missing.key}', which is required`;
		}
	}
}

/**
 * **A default as the document publishes it**: openapi3's `serializeValueAsJson` - wire names for an
 * object's keys, a scalar constructor written through the property's encoding, so
 * `utcDateTime.fromISO("2020-01-01T00:00:00Z")` under `unixTimestamp` is `1577836800`. `undefined`
 * where it cannot be serialized, which openapi3 reports as `default-not-supported`.
 */
function defaultJsonOf(program: Program, property: ModelProperty): { json: unknown } | undefined {
	const value = property.defaultValue;
	if (value === undefined) return undefined;
	try {
		const json = serializeValueAsJson(program, value, property);
		return json === undefined ? undefined : { json };
	} catch {
		return undefined;
	}
}

function jsonTypeOfValue(json: unknown): string {
	if (json === null) return "null";
	if (Array.isArray(json)) return "array";
	if (typeof json === "number") return Number.isInteger(json) ? "integer" : "number";
	return typeof json;
}

/** A JSON value as a JS literal, every string through `literal` so the module stays ASCII. */
function jsonLiteral(json: unknown): string {
	if (typeof json === "string") return literal(json);
	if (Array.isArray(json)) return `[${json.map(jsonLiteral).join(", ")}]`;
	if (json !== null && typeof json === "object") {
		return `{${Object.entries(json)
			.map(([key, value]) => `${literal(key)}: ${jsonLiteral(value)}`)
			.join(", ")}}`;
	}
	return String(json);
}

/** A property's declared default, as the JSON the document publishes filled in, or `undefined`. */
function defaultOf(program: Program, property: ModelProperty, position: PropertyPosition): unknown {
	const value = property.defaultValue;
	if (value === undefined) return undefined;
	const serialized = defaultJsonOf(program, property);
	if (serialized === undefined) {
		reportDiagnostic(program, {
			code: "unsupported-default",
			target: property,
			format: { why: `kind "${value.valueKind}"` },
		});
		/**
		 * **No `.default(...)` at all, rather than a default this emitter invented.** The property keeps
		 * its declared shape and loses only the fallback, which the diagnostic names.
		 */
		return undefined;
	}
	const clash = defaultClashOf(program, property, position, serialized.json);
	if (clash !== undefined) {
		if (firstReportOf(program, "invalid-default", property)) {
			reportDiagnostic(program, {
				code: "invalid-default",
				target: property,
				format: { name: property.name, why: clash },
			});
		}
		return undefined;
	}
	return filledDefaultOf(program, property.type, serialized.json);
}

/**
 * **Whether a default sets, at any depth, a declared key of an object whose typed indexer refuses the
 * key's value**, which no literal of the validator's type can do. Zod types `.catchall()` over every
 * key, declared ones included, so `ObjIdx { s?: string; ...Record<int32> }` is `{ [x: string]:
 * number; s?: string }`, and TypeScript holds `s` to both: `r?: ObjIdx = #{ s: "x" }`, which the
 * document and the validator accept, was emitted as `.default({"s": "x"})` and the module failed to
 * typecheck, `TS2769`, the default no value of the type. A key the indexer holds as well, `#{ k: 1 }`,
 * is one.
 */
function setsKeyItsIndexerRefuses(program: Program, type: Type, json: unknown): boolean {
	const declared = nullableInnerOf(type) ?? type;
	if (json === null || typeof json !== "object") return false;
	if (declared.kind === "Union") {
		return membersOf(declared).some((member) => setsKeyItsIndexerRefuses(program, member, json));
	}
	if (declared.kind !== "Model") return false;
	if (Array.isArray(json)) {
		const element = declared.indexer?.key.name === "integer" ? declared.indexer.value : undefined;
		return (
			element !== undefined &&
			json.some((item: unknown) => setsKeyItsIndexerRefuses(program, element, item))
		);
	}
	return withVisibility(renderedVisibilityOf(program, declared, visibility), () => {
		const object = objectOfModel(program, declared);
		if (object.kind !== "object") return false;
		const rest = typeof object.rest === "string" ? undefined : object.rest;
		return Object.entries(json).some(([key, value]) => {
			const member = object.members.find((each) => each.key === key);
			if (member === undefined || object.dictionary) {
				return rest?.kind === "type" && setsKeyItsIndexerRefuses(program, rest.type, value);
			}
			if (rest !== undefined && mergedClashOf(program, value, rest) !== undefined) return true;
			return (
				member.property !== undefined &&
				setsKeyItsIndexerRefuses(program, member.property.type, value)
			);
		});
	});
}

/**
 * **A default as the validator hands it over: the document's value, with the default of every key it
 * leaves out filled in, at any depth.** `.default()` hands its value over unparsed, so
 * `inner?: Inner = #{ b: "x" }` beside `Inner`'s own `a?: int32 = 1` gave the handler an `Inner` with
 * no `a`, and the module did not typecheck: the value is the validator's OUTPUT, where `a` is filled.
 * Filled here, it is the value a parse of the document's default produces.
 */
function filledDefaultOf(program: Program, type: Type, json: unknown): unknown {
	const declared = nullableInnerOf(type) ?? type;
	if (declared.kind !== "Model" || json === null || typeof json !== "object") return json;
	const indexed = declared.indexer;
	if (Array.isArray(json)) {
		return indexed?.key.name === "integer"
			? json.map((item) => filledDefaultOf(program, indexed.value, item))
			: json;
	}
	const own = (target: Record<string, unknown>, key: string, value: unknown): void => {
		// Defined as an own key, so a key named `__proto__` is a key and not the prototype.
		Object.defineProperty(target, key, {
			value,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	};
	const filled: Record<string, unknown> = {};
	if (indexed?.key.name === "string" && declared.properties.size === 0) {
		for (const [key, value] of Object.entries(json)) {
			own(filled, key, filledDefaultOf(program, indexed.value, value));
		}
		return filled;
	}
	for (const [key, value] of Object.entries(json)) own(filled, key, value);
	return withVisibility(renderedVisibilityOf(program, declared, visibility), () => {
		for (const entry of publishedPropertiesOf(program, declared)) {
			const key = rawPropertyKey(program, entry.property);
			if (Object.prototype.hasOwnProperty.call(filled, key)) {
				own(filled, key, filledDefaultOf(program, entry.property.type, filled[key]));
				continue;
			}
			if (!emitsDefault(program, entry.property, positionOf(program, declared, entry))) continue;
			const inner = defaultJsonOf(program, entry.property);
			if (inner !== undefined) {
				own(filled, key, filledDefaultOf(program, entry.property.type, inner.json));
			}
		}
		return filled;
	});
}

/** The non-null half of a two-variant `T | null` union, or `undefined` if it is not one. */
export function nullableInnerOf(type: Type): Type | undefined {
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
/**
 * **An instance of a list template is refused**: `model Page<T> is T[]` made `Page<Item>`, which
 * openapi3 emits as a template instance - an object - and publishes as `type: object` with the
 * element as `additionalProperties`, a dictionary where the spec declares a list. No validator agrees
 * with both. A named list per element type, `model Items is Item[]`, or `Item[]` itself, is a list in
 * the document too.
 */
export function listTemplateInstanceWhy(program: Program, type: Model): string | undefined {
	return type.templateMapper !== undefined &&
		type.indexer?.key.name === "integer" &&
		!isArrayLiteral(program, type)
		? "an instance of a list template, which openapi3 publishes as an object of its elements, not a list"
		: undefined;
}

export const LIST_TEMPLATE_REMEDY =
	"Declare a named list model per element type, `model Items is Item[]`, or use `Item[]` itself.";

export function typeToZodBody(program: Program, type: Type): string {
	switch (type.kind) {
		case "Scalar":
			return scalarToZod(program, type);
		case "Model": {
			const why = listTemplateInstanceWhy(program, type);
			if (why !== undefined) return refuse(program, type, why, LIST_TEMPLATE_REMEDY);
			return modelToZod(program, type);
		}
		case "Enum":
			return enumToZod(program, type);
		case "Union":
			return unionToZod(program, type);
		case "String":
			return `z.literal(${literal(type.value)})`;
		case "Number":
			return `z.literal(${type.value})`;
		case "Boolean":
			return `z.literal(${String(type.value)})`;
		case "EnumMember":
			return `z.literal(${literal(type.value ?? type.name)})`;
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
		case "Intrinsic": {
			if (type.name === "null") {
				const why = unpublishableNullWhy(program, type);
				return why === undefined ? "z.null()" : refuseUnpublishableNull(program, type, why);
			}
			if (type.name === "unknown") return "z.unknown()";
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
		}
		/**
		 * **openapi3 publishes a tuple as `prefixItems`, with no `items` or `minItems` beside it**:
		 * any length, each position checked where it is present, anything past the last. That is a
		 * tuple whose every position is optional and whose rest is `unknown` - `z.tuple([...],
		 * z.unknown())`, which `z.toJSONSchema` gives back as the same `prefixItems`. Refused as a
		 * parameter - see `parameterPosition`. Refused outright, an OAuth2 flow model, whose `scopes`
		 * is a tuple and which openapi3 publishes as a component, stopped a service compiling.
		 */
		case "Tuple": {
			if (parameterPosition)
				return refuse(program, type, TUPLE_PARAMETER.why, TUPLE_PARAMETER.remedy);
			const positions = type.values.map((value) => `${typeToZod(program, value)}.exactOptional()`);
			// `z.tuple` takes at least one position; with none, `prefixItems: []` is any list.
			return positions.length === 0
				? "z.array(z.unknown())"
				: `z.tuple([${positions.join(", ")}], z.unknown())`;
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
