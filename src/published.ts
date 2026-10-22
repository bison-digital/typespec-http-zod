import {
	getDiscriminatedUnion,
	getDiscriminatedUnionFromInheritance,
	getDiscriminator,
	getTypeName,
	isGlobalNamespace,
	isNeverType,
	isVoidType,
	navigateTypesInNamespace,
	type Enum,
	type Model,
	type ModelProperty,
	type Namespace,
	type Operation,
	type Program,
	type Type,
	type Union,
} from "@typespec/compiler";
import {
	getHttpOperation,
	getHttpService,
	getVisibilitySuffix,
	isOrExtendsHttpFile,
	isOverloadSameEndpoint,
	resolveAuthentication,
	resolveRequestVisibility,
	Visibility,
	type HttpOperation,
	type HttpPayloadBody,
} from "@typespec/http";
import { shouldInline } from "@typespec/openapi";
import { firstReportOf } from "./constraints.js";
import { reportDiagnostic } from "./lib.js";
import {
	includeDerivedModel,
	externalReferenceOf,
	holdsRawBytes,
	bindingIndexerOf,
	isArrayLiteral,
	isAssignable,
	isNamedList,
	isSpeakableInstance,
	rawPropertyKey,
	metadataInfoOf,
	renderedVisibilityOf,
	rootVisibilityOf,
} from "./zod.js";

/**
 * **What `@typespec/openapi3` publishes for one service, as far as it is not the schema of a type at
 * a visibility.** Two things the document holds depend on the whole service and not on the type in
 * hand, and both are read here the way openapi3 reads them:
 *
 * - **Its components' names** - {@link usageOf}. openapi3 suffixes a component with a visibility only
 *   where its type is used at more than one.
 * - **Its components' content** - {@link publicationOf}. openapi3 writes a component from the first
 *   reference that reaches it, and that reference's visibility shows through.
 */
interface ServiceView {
	readonly usage: VisibilityUsage;
	readonly publication: Publication;
	readonly unreached: readonly Type[];
	/** The visibility a shared parameter component is published at - see `parameterVisibilityOf`. */
	readonly parameters: ReadonlyMap<ModelProperty, Visibility>;
	/** A shared route's parameter read as the one published for its name - see `parameterVisibilityOf`. */
	readonly routeParameters: ReadonlyMap<ModelProperty, Visibility>;
	/** A shared route's parameter openapi3 publishes optional - see `isSharedRouteOptional`. */
	readonly sharedOptional: ReadonlySet<ModelProperty>;
	/** The visibility a shared route's requests are published at - see `requestVisibilityOf`. */
	readonly requests: ReadonlyMap<Operation, Visibility>;
}

let view: ServiceView | undefined;
const views = new WeakMap<Namespace, ServiceView>();

export function withServiceView<T>(program: Program, service: Namespace, run: () => T): T {
	const restore = beginServiceView(program, service);
	try {
		return run();
	} finally {
		restore();
	}
}

/** The same scope, held across an `await` - returns what puts the previous one back. */
export function beginServiceView(program: Program, service: Namespace): () => void {
	const previous = view;
	let next = views.get(service);
	if (next === undefined) {
		const { usage, reachable } = usageOf(program, service);
		const { claims, unreached, parameters, routeParameters, sharedOptional, requests } =
			publicationOf(program, service, reachable);
		next = {
			usage,
			publication: claims,
			unreached,
			parameters,
			routeParameters,
			sharedOptional,
			requests,
		};
		views.set(service, next);
	}
	view = next;
	return () => {
		view = previous;
	};
}

/**
 * **Where each type is used, by visibility: openapi3's own `resolveVisibilityUsage`.** openapi3 names
 * a component with a visibility suffix only where its type is used at more than one visibility, so a
 * model only ever sent in a create body is published as `Holder`, rendered at `Create`, where a model
 * also returned is `Holder` and `HolderCreate`. The declarations and contract types here take the
 * document's names, so this is read the way openapi3 reads it: each operation's body and parameters at
 * its request visibility, its return type at `Read`, a list's elements with `Item`, through every
 * property, base and derived model; and every type of the service no operation reaches at `All`, as
 * openapi3 does with `omitUnreachableTypes` unset.
 */
type VisibilityUsage = ReadonlyMap<Type, ReadonlySet<Visibility>>;

/**
 * **The types of the service no operation reaches, which openapi3 publishes as components all the
 * same** - its `processUnreferencedSchemas`, with `omitUnreachableTypes` unset: every model, enum and
 * union declared in the service namespace and below it (only the service's own, where the service is
 * the global namespace), but not one an operation reaches, a model whose properties were spread as
 * parameters (published as parameters), a type openapi3 inlines, an HTTP file, or an authentication
 * scheme's model. Rendered at `All` by the caller, as openapi3 renders them. A scalar is validated
 * inline wherever it is used, reached or not, so an unreached one has nothing to declare.
 */
export function unreachedTypes(): readonly Type[] {
	return view?.unreached ?? [];
}

/** Every type the service publishes, reached by an operation or not - read as {@link usageOf} reads it. */
export function publishedTypes(): Iterable<Type> {
	return view?.usage.keys() ?? [];
}

function unreachedOf(
	program: Program,
	service: Namespace,
	reachable: ReadonlySet<Type>,
	parameterModels: ReadonlySet<Model>,
): Type[] {
	const [http] = getHttpService(program, service);
	const schemes = new Set<Type>(resolveAuthentication(http).schemes.map((scheme) => scheme.model));
	const found: Type[] = [];
	const add = (type: Model | Enum | Union): void => {
		if (
			type.kind === "Model" &&
			(isOrExtendsHttpFile(program, type) || parameterModels.has(type))
		) {
			return;
		}
		if (schemes.has(type) || reachable.has(type) || shouldInline(program, type)) return;
		// Published as a reference to another document, never as a component.
		if (externalReferenceOf(type) !== undefined) return;
		found.push(type);
	};
	navigateTypesInNamespace(
		service,
		{ model: add, enum: add, union: add },
		{ skipSubNamespaces: isGlobalNamespace(program, service) },
	);
	return found;
}

/** Whether openapi3 suffixes this type's component with the visibility it is rendered at. */
export function isSuffixedByUsage(type: Type): boolean {
	// With no service's usage in scope, every view is told apart, so no two share a name.
	if (view === undefined) return true;
	return (view.usage.get(type)?.size ?? 0) > 1;
}

function usageOf(
	program: Program,
	service: Namespace,
): { usage: VisibilityUsage; reachable: ReadonlySet<Type> } {
	const usage = new Map<Type, Set<Visibility>>();
	const exact = (type: Type, at: Visibility): void => {
		const seen = usage.get(type) ?? new Set<Visibility>();
		seen.add(at);
		usage.set(type, seen);
	};
	/**
	 * Its effective payload type too, as openapi3's `trackUsage` counts it - but not in the pass over
	 * types no operation reaches, which is its `trackUsageExact`: counted there, `{ ...Foo; @header h }`
	 * held by an unreached model gave `Foo` a second visibility, and a suffix the document does not.
	 */
	let exactOnly = false;
	const track = (type: Type, at: Visibility): void => {
		exact(type, at);
		if (exactOnly) return;
		const effective = metadataInfoOf(program).getEffectivePayloadType(type, at);
		if (effective !== type) exact(effective, at);
	};
	const visited = new Map<Type, Set<Visibility>>();
	const navigate = (type: Type, at: Visibility): void => {
		const seen = visited.get(type) ?? new Set<Visibility>();
		if (seen.has(at)) return;
		seen.add(at);
		visited.set(type, seen);
		switch (type.kind) {
			case "Model":
				track(type, at);
				for (const property of type.properties.values()) navigate(property, at);
				if (type.baseModel !== undefined) navigate(type.baseModel, at);
				for (const derived of type.derivedModels) navigate(derived, at);
				if (type.indexer !== undefined) {
					navigate(
						type.indexer.value,
						type.indexer.key.name === "integer" ? at | Visibility.Item : at,
					);
				}
				return;
			case "ModelProperty":
				return navigate(type.type, at);
			case "Union":
				track(type, at);
				for (const variant of type.variants.values()) navigate(variant, at);
				return;
			case "UnionVariant":
				return navigate(type.type, at);
			default:
				track(type, at);
		}
	};
	const operation = (each: Operation): void => {
		const [http] = getHttpOperation(program, each);
		const at = resolveRequestVisibility(program, each, http.verb);
		const body = http.parameters.body;
		if (body !== undefined) {
			navigate(body.type, at);
			if (body.bodyKind === "multipart") {
				for (const part of body.parts) navigate(part.body.type, at);
			}
		}
		for (const parameter of http.parameters.parameters) navigate(parameter.param, at);
		navigate(each.returnType, Visibility.Read);
	};
	const container = (namespace: Namespace): void => {
		for (const nested of namespace.namespaces.values()) container(nested);
		for (const contract of namespace.interfaces.values()) {
			for (const each of contract.operations.values()) operation(each);
		}
		for (const each of namespace.operations.values()) operation(each);
	};
	container(service);
	// openapi3's `isUnreachable`: what no operation reaches, before the pass below adds it at `All`.
	const reachable = new Set(usage.keys());
	exactOnly = true;
	const unreached = (type: Type): void => {
		if (!usage.has(type)) {
			visited.clear();
			navigate(type, Visibility.All);
		}
	};
	navigateTypesInNamespace(service, {
		model: unreached,
		scalar: unreached,
		enum: unreached,
		union: unreached,
	});
	return { usage, reachable };
}

/**
 * **The reference each schema is written from: openapi3's emission order, and its asset emitter's
 * cache.** openapi3 emits a schema once per type, reduced visibility and metadata context, from
 * whichever reference reaches it first, and every later reference shares that schema - a component
 * by `$ref`, a model expression or an inlined template instance written out again from the cache.
 * Measured on `@typespec/openapi3` 1.17.0 with `@typespec/asset-emitter` 0.79.3, the first reference
 * shows through:
 *
 * A model with nothing to reshape at the request's visibility is reduced to `Read`, and its
 * `required` list is read there. But its properties are read by `modelProperties`, a step whose stack
 * entry names the same type as the reference, so the asset emitter merges the reference's context
 * back over the reduced one, and they are read at the request's visibility. A read-only `id` is then
 * required and not declared: `Outer { @visibility(Create) secret; inner: Inner }` sent to a create
 * operation publishes `Inner` as `required: [id, name]`, `properties: {name}`, which no value
 * satisfies under `seal-object-schemas` - and every response returning `Inner` shares it. Returned by
 * an earlier operation, `Inner` is reached at `Read` first and published as declared. An optional
 * read-only property is left out instead, and a sealed response then refuses the `id` it carries.
 *
 * So this follows openapi3: operations grouped by verb and path in the service's order, an operation
 * whose path holds a query string skipped as openapi3 skips it, each one's parameters, then its
 * responses, then its request body - a shared route's responses first, then its parameters grouped by
 * name as `resolveSharedRouteParameters` groups them, then its bodies - and every type no operation
 * reaches last, at `All`. Through each schema: its properties at the visibility the reference arrived
 * at, then its indexer, derived models, discriminator mapping and base at the reduced one. A list -
 * `T[]` adds `Item` - a named list and a union expression are not reduced. Of two components written
 * under one name - one in each metadata context - `components.schemas` keeps the later.
 */
interface Claim {
	/** The visibility the first reference arrived at, which the schema's properties are read at. */
	readonly at: Visibility;
	/** Whether that reference was under an explicit `@body` with metadata annotations. */
	readonly ignore: boolean;
	/** Where the walk that made it started, for the diagnostic. */
	readonly via: Via;
	/** When its emission completed: of two components under one name, the later one is published. */
	order: number;
	/** Whether it was written as a multipart part's union holding raw `bytes` - see `withMultipartBinary`. */
	readonly binary: boolean;
}

/**
 * An operation's body, part or parameter a walk starts from: `where`, as the diagnostic says it, and
 * `root`, the name of its type where it has one - wrapped in a visibility template, as
 * `Create<Outer>`, the request is published from a model of its own and leaves the shared ones alone.
 */
interface Via {
	readonly where: string;
	readonly root: string | undefined;
	/** Whether the root is a model, which a visibility template such as `Create<...>` takes. */
	readonly model: boolean;
	/** The root itself, where it is a named model or union - see {@link viewRemedyOf}. */
	readonly type?: Type;
}

/** Per type, per visibility it is published at: one claim per metadata context. */
type Publication = ReadonlyMap<Type, ReadonlyMap<Visibility, readonly Claim[]>>;

/** An HTTP parameter openapi3 publishes as one - its `isHttpParameterProperty`. */
type ParameterProperty = Extract<
	HttpOperation["parameters"]["properties"][number],
	{ kind: "header" | "query" | "path" | "cookie" }
>;

function isParameterProperty(
	each: HttpOperation["parameters"]["properties"][number],
): each is ParameterProperty {
	return (
		each.kind === "header" ||
		each.kind === "query" ||
		each.kind === "path" ||
		each.kind === "cookie"
	);
}

function publicationOf(
	program: Program,
	service: Namespace,
	reachable: ReadonlySet<Type>,
): {
	claims: Publication;
	unreached: readonly Type[];
	parameters: ReadonlyMap<ModelProperty, Visibility>;
	routeParameters: ReadonlyMap<ModelProperty, Visibility>;
	sharedOptional: ReadonlySet<ModelProperty>;
	requests: ReadonlyMap<Operation, Visibility>;
} {
	const info = metadataInfoOf(program);
	const claims = new Map<Type, Map<Visibility, Claim[]>>();
	let completed = 0;
	/** The union of the multipart part being written, where it holds raw `bytes`. */
	let binaryPart: Type | undefined;

	/** Run `children` as the emission of `type` reached at `at`, unless openapi3 has it cached. */
	const emitting = (
		type: Model | Union | Enum,
		at: Visibility,
		ignore: boolean,
		via: Via,
		children: (reduced: Visibility) => void,
	): void => {
		const reduced = renderedVisibilityOf(program, type, at);
		const byVisibility = claims.get(type) ?? new Map<Visibility, Claim[]>();
		claims.set(type, byVisibility);
		const list = byVisibility.get(reduced) ?? [];
		byVisibility.set(reduced, list);
		const binary = type === binaryPart;
		if (list.some((claim) => claim.ignore === ignore && claim.binary === binary)) return;
		const claim: Claim = { at, ignore, via, order: Number.POSITIVE_INFINITY, binary };
		list.push(claim);
		children(reduced);
		completed += 1;
		claim.order = completed;
	};

	const emit = (type: Type, at: Visibility, ignore: boolean, via: Via): void => {
		switch (type.kind) {
			case "ModelProperty":
				return emit(type.type, at, ignore, via);
			/**
			 * `unionVariant`: a reference to a variant - `v: U.a` - is its type's, where it is used. Not
			 * followed, `IR` sent in a PATCH through `U.a` was published as `IRUpdate` with nothing here
			 * to say so, and its validator was `IR`'s.
			 */
			case "UnionVariant":
				return emit(type.type, at, ignore, via);
			case "Tuple":
				for (const value of type.values) emit(value, at, ignore, via);
				return;
			case "Model":
				if (isArrayLiteral(program, type) && type.indexer !== undefined) {
					// `arrayLiteralReferenceContext`: the elements at the list's visibility, with `Item`.
					return emit(type.indexer.value, at | Visibility.Item, ignore, via);
				}
				return emitting(type, at, ignore, via, (reduced) => {
					if (isNamedList(type) && type.indexer !== undefined) {
						return emit(type.indexer.value, at, ignore, via);
					}
					for (const property of type.properties.values()) {
						if (isNeverType(property.type)) continue;
						if (!info.isPayloadProperty(property, at, ignore)) continue;
						emit(property.type, at, ignore, via);
					}
					if (type.indexer !== undefined && !isNeverType(type.indexer.value)) {
						emit(type.indexer.value, reduced, ignore, via);
					}
					for (const derived of type.derivedModels.filter(includeDerivedModel)) {
						emit(derived, reachable.has(derived) ? reduced : Visibility.All, ignore, via);
					}
					const discriminator = getDiscriminator(program, type);
					if (discriminator !== undefined) {
						const [dispatch] = getDiscriminatedUnionFromInheritance(type, discriminator);
						for (const variant of dispatch.variants.values()) emit(variant, reduced, ignore, via);
					}
					if (type.baseModel !== undefined) emit(type.baseModel, reduced, ignore, via);
				});
			case "Enum":
				// A component wherever it is reached, an encoded list's element included.
				return emitting(type, at, ignore, via, () => undefined);
			case "Union":
				return emitting(type, at, ignore, via, (reduced) => {
					const [discriminated] = getDiscriminatedUnion(program, type);
					if (discriminated !== undefined) {
						for (const variant of discriminated.variants.values())
							emit(variant, reduced, ignore, via);
						// A default variant is published beside the others only where there is no envelope.
						if (
							discriminated.defaultVariant !== undefined &&
							discriminated.options.envelope === "none"
						) {
							emit(discriminated.defaultVariant, reduced, ignore, via);
						}
						return;
					}
					for (const variant of type.variants.values()) emit(variant.type, reduced, ignore, via);
				});
			default:
				return;
		}
	};

	/** `emitTypeWithSchemaEmitter`: a root not transformed at its visibility is emitted at `Read`. */
	const root = (type: Type, at: Visibility, ignore: boolean, where: string): void => {
		const named = (type.kind === "Model" || type.kind === "Union") && !shouldInline(program, type);
		const name = named ? getTypeName(type, { namespaceFilter: () => false }) : undefined;
		emit(type, rootVisibilityOf(program, type, at), ignore, {
			where,
			root: name,
			model: type.kind === "Model",
			...(named ? { type } : {}),
		});
	};

	const payload = (body: HttpPayloadBody, at: Visibility, where: string): void => {
		switch (body.bodyKind) {
			case "single":
				return root(
					info.getEffectivePayloadType(body.type, at),
					at,
					body.isExplicit && body.containsMetadataAnnotations,
					where,
				);
			case "multipart":
				for (const part of body.parts) {
					const inPart = `the '${part.name ?? ""}' part of ${where}`;
					if (part.body.bodyKind !== "file") {
						binaryPart = holdsRawBytes(program, part.body.type) ? part.body.type : undefined;
						payload(part.body, at, inPart);
						binaryPart = undefined;
					}
					for (const header of part.headers) root(header.property.type, at, false, inPart);
				}
				return;
			case "file":
				return;
		}
	};

	/** Spread parameters of a named model, which openapi3 emits once and shares. */
	const sharedParameters = new Map<ModelProperty, Visibility>();
	/** A shared route's parameter read as the one openapi3 publishes for its name, by its own property. */
	const routeParameters = new Map<ModelProperty, Visibility>();
	const sharedOptional = new Set<ModelProperty>();
	/** Each operation of a shared route, at the visibility of its first. */
	const requests = new Map<Operation, Visibility>();
	/** Their models, which openapi3 publishes as parameters and not again as schemas. */
	const parameterModels = new Set<Model>();
	const parameter = (operation: HttpOperation, each: ParameterProperty, at: Visibility): void => {
		if (isNeverType(each.property.type)) return;
		// Published as a reference to another document, with nothing written for it.
		if (externalReferenceOf(each.property) !== undefined) return;
		const source = sourceOf(each.property);
		if (sharedParameters.has(source)) return;
		const where = `the '${each.options.name}' parameter of '${operation.operation.name}'`;
		root(each.property.type, at, false, where);
		if (
			source !== each.property &&
			source.model !== undefined &&
			!shouldInline(program, source.model)
		) {
			sharedParameters.set(source, at);
			parameterModels.add(source.model);
		}
	};
	const responses = (operation: HttpOperation): void => {
		const where = `a response of '${operation.operation.name}'`;
		for (const response of operation.responses) {
			// A response whose type is a reference to another document is that reference, and no more.
			if (externalReferenceOf(response.type) !== undefined) continue;
			for (const content of response.responses) {
				for (const header of Object.values(content.headers ?? {})) {
					root(header.type, Visibility.Read, false, where);
				}
				if (content.body !== undefined && !isVoidType(content.body.type)) {
					payload(content.body, Visibility.Read, where);
				}
			}
		}
	};
	const body = (operation: HttpOperation, at: Visibility): void => {
		const requestBody = operation.parameters.body;
		if (requestBody === undefined || isVoidType(requestBody.type)) return;
		payload(requestBody, at, `the request body of '${operation.operation.name}'`);
	};

	const [http] = getHttpService(program, service);
	const routes = new Map<string, HttpOperation[]>();
	for (const operation of http.operations) {
		const overloading = operation.overloading;
		if (overloading !== undefined && isOverloadSameEndpoint({ ...operation, overloading }))
			continue;
		const key = `${operation.verb}|${operation.path}`;
		const shared = routes.get(key);
		if (shared === undefined) routes.set(key, [operation]);
		else shared.push(operation);
	}
	for (const operations of routes.values()) {
		const [first] = operations;
		if (first === undefined) continue;
		const at = resolveRequestVisibility(program, first.operation, first.verb);
		if (operations.length === 1) {
			// `path-query`: openapi3 publishes nothing for an operation whose path holds a query string.
			if (first.path.indexOf("?") > 0) continue;
			for (const each of first.parameters.properties) {
				if (isParameterProperty(each)) parameter(first, each, at);
			}
			responses(first);
			body(first, at);
			continue;
		}
		for (const operation of operations) requests.set(operation.operation, at);
		for (const operation of operations) responses(operation);
		// `resolveSharedRouteParameters`: by name, in the order each name is first met.
		const byName = new Map<string, [HttpOperation, ParameterProperty][]>();
		for (const operation of operations) {
			for (const each of operation.parameters.properties) {
				if (!isParameterProperty(each)) continue;
				const group = byName.get(each.options.name) ?? [];
				group.push([operation, each]);
				byName.set(each.options.name, group);
			}
		}
		/**
		 * **One parameter per name where every operation declares it alike**, as openapi3 publishes
		 * it: the first's, with the location, optionality and type the rest share. The rest are read as
		 * that one is; their models are not parameter models, and a spread model only they use is
		 * published as a type no operation reaches. Followed member by member, a GET's spread
		 * `...CommonF` claimed `CommonF.f` at `Query`, and a later POST sending it was read there,
		 * where the document reads it at `Create`.
		 */
		for (const group of byName.values()) {
			const [reference, ...rest] = group;
			if (reference === undefined) continue;
			const declared = reference[1].property;
			const alike = rest.every(
				([, each]) =>
					each.kind === reference[1].kind &&
					each.property.optional === declared.optional &&
					each.property.type.kind === declared.type.kind &&
					each.property.type === declared.type,
			);
			/**
			 * **Optional where openapi3 makes it so**: a parameter alike in the operations declaring
			 * it but missing from one, or in all of them but declared unalike. openapi3 does it by setting
			 * `optional` on the declarations while it emits, so read from them, `sa`'s required `q`
			 * beside `sb`, which has none, was required when this emitter ran first and optional when it
			 * ran after - the document's - from one spec.
			 */
			const inAll = group.length === operations.length;
			const consistent = group.every(
				([, each]) =>
					each.kind === reference[1].kind &&
					each.property.optional === declared.optional &&
					each.property.type.kind === declared.type.kind,
			);
			if ((alike && !inAll) || (inAll && !consistent)) {
				for (const [, each] of group) sharedOptional.add(each.property);
			}
			if (!alike) {
				for (const [operation, each] of group) parameter(operation, each, at);
				continue;
			}
			parameter(reference[0], reference[1], at);
			const readAt = sharedParameters.get(sourceOf(declared)) ?? at;
			for (const [, each] of rest) routeParameters.set(each.property, readAt);
		}
		const bodies = new Set<HttpPayloadBody>();
		for (const operation of operations) {
			const requestBody = operation.parameters.body;
			if (requestBody === undefined || bodies.has(requestBody)) continue;
			bodies.add(requestBody);
			body(operation, at);
		}
	}
	// `processUnreferencedSchemas`: what no operation reaches, at `All`, written last.
	const unreached = unreachedOf(program, service, reachable, parameterModels);
	for (const type of unreached) root(type, Visibility.All, false, "a type no operation reaches");
	return {
		claims,
		unreached,
		parameters: sharedParameters,
		routeParameters,
		sharedOptional,
		requests,
	};
}

/** The declaration a spread parameter was copied from, or the parameter itself. */
function sourceOf(property: ModelProperty): ModelProperty {
	let source = property;
	while (source.sourceProperty !== undefined) source = source.sourceProperty;
	return source;
}

/**
 * **The visibility openapi3 reads a model's own properties at, where it publishes the model at
 * `at`: the visibility the reference it writes the schema from arrived at** - see
 * {@link publicationOf}. Where nothing reshapes the model there, the two are one schema - anything
 * else is `split-visibility` - but a type a property refers to is reached at the first, and a list
 * or a union instance is not reduced: `Mid { tags: Tags }` first sent in a create body and also
 * returned is published as `Mid`, its `tags` referring to `TagsCreate`. A component is read as
 * `components.schemas` keeps it, the later of two metadata contexts; a model written out where it
 * is used, as the context `ignore` writes it. Where no reference wrote it, at `at`.
 */
export function readVisibilityOf(
	program: Program,
	model: Model,
	at: Visibility,
	ignore: boolean,
): Visibility {
	const claims = view?.publication.get(model)?.get(at) ?? [];
	const claim = shouldInline(program, model)
		? claims.find((each) => each.ignore === ignore)
		: latestOf(claims);
	return claim?.at ?? at;
}

/**
 * **The visibility of the component the document keeps for a type rendered at `at`.** Where the type
 * is published at several visibilities under one name - unsuffixed, as openapi3 names a type it
 * counts at one - `components.schemas` keeps the one written last, and every `$ref` to the name is
 * to it. `K extends P`, written at `All` by the pass over types no operation reaches and at `Read` by
 * `P`'s discriminator mapping, is `K` at `Read` in the document; `G extends K`, written out from
 * `K` at `All`, required a create-only `s` the `K` it refers to leaves out. Elsewhere, `at`.
 */
export function keptVisibilityOf(type: Type, at: Visibility): Visibility {
	const byVisibility = view?.publication.get(type);
	if (byVisibility === undefined || byVisibility.size < 2 || isSuffixedByUsage(type)) return at;
	let kept: { at: Visibility; order: number } | undefined;
	for (const [each, claims] of byVisibility) {
		const latest = latestOf(claims);
		if (latest !== undefined && (kept === undefined || latest.order > kept.order)) {
			kept = { at: each, order: latest.order };
		}
	}
	return kept?.at ?? at;
}

function latestOf(claims: readonly Claim[]): Claim | undefined {
	return claims.reduce<Claim | undefined>(
		(latest, each) => (latest === undefined || each.order > latest.order ? each : latest),
		undefined,
	);
}

/**
 * **Every component openapi3 writes, at the visibility it publishes it at, in the metadata context
 * `components.schemas` keeps** - declared after the routes, so a component no route renders by name
 * is declared all the same. A model a merge holds is written into the merge here, and openapi3
 * publishes it as a component of its own: `L1 extends L0 { m: B }` and `L2 extends L1 { m: Sub }`
 * publish `B` and `Sub`, which had no validator.
 */
export function publishedComponents(program: Program): readonly {
	readonly type: Type;
	readonly at: Visibility;
	readonly ignore: boolean;
	readonly binary: boolean;
}[] {
	const found: { type: Type; at: Visibility; ignore: boolean; binary: boolean }[] = [];
	for (const [type, byVisibility] of view?.publication ?? []) {
		if (type.kind !== "Model" && type.kind !== "Union" && type.kind !== "Enum") continue;
		if (shouldInline(program, type) || !isSpeakableInstance(type)) continue;
		if (externalReferenceOf(type) !== undefined) continue;
		for (const [at, claims] of byVisibility) {
			// One component per context it is written in: a part's binary union is one of its own.
			for (const binary of [false, true]) {
				const latest = latestOf(claims.filter((claim) => claim.binary === binary));
				if (latest !== undefined) found.push({ type, at, ignore: latest.ignore, binary });
			}
		}
	}
	return found;
}

/**
 * **The visibility openapi3 publishes a parameter at, where it is not the operation's.** A parameter
 * spread from a named model is published once, as a shared parameter component, from the first
 * operation that sends it, and every later one refers to it: `...CommonA` sent by a GET and then by a
 * POST is read at `Query` for both. Read at each operation's own, the POST was held to a create view
 * the document does not publish for it.
 */
/**
 * Whether openapi3 publishes a shared route's parameter optional though it is declared required -
 * see `resolveSharedRouteParameters` - asked of the declaration, before or after openapi3 sets its
 * `optional`, with one answer.
 */
export function isSharedRouteOptional(property: ModelProperty): boolean {
	return view?.sharedOptional.has(property) ?? false;
}

export function parameterVisibilityOf(property: ModelProperty): Visibility | undefined {
	return view?.routeParameters.get(property) ?? view?.parameters.get(sourceOf(property));
}

/**
 * **The visibility openapi3 publishes an operation's request at.** Its own, unless it shares its
 * verb and path with another: openapi3 publishes one operation for the route, every body and
 * parameter at the first one's visibility, and reports `inconsistent-shared-route-request-visibility`
 * where they differ - graded against what it publishes.
 */
export function requestVisibilityOf(program: Program, operation: HttpOperation): Visibility {
	return (
		view?.requests.get(operation.operation) ??
		resolveRequestVisibility(program, operation.operation, operation.verb)
	);
}

/**
 * **How openapi3's schema for a model differs from the schema of that model at the visibility it is
 * rendered at.** openapi3 reads a model's properties at the visibility its first reference arrived
 * at - `document` here - and its `required` at the one it reduces that to; the schema it means, and
 * the one rendered here, reads both at the reduced one - `rendered`. Where no reduction intervenes
 * they are one schema. Only the model's own properties are compared: a type a property refers to has
 * a first reference of its own, and is judged by it where it is rendered - a component wherever it
 * is declared, and a model expression where it is written out, as openapi3 writes it out from its
 * cache. A base is part of the model's schema, through `allOf`.
 */
export interface Misreading {
	/** The model whose properties openapi3 reads at {@link at}: the one judged, or a base of it. */
	readonly model: Model;
	/** The property its schema gets wrong. */
	readonly property: ModelProperty;
	/** The visibility openapi3 reads the properties at. */
	readonly at: Visibility;
	/** What openapi3 publishes for the property. */
	readonly effect: "undeclared" | "dropped" | "added" | "reshaped";
	/** Where the schema it is found in was first reached from. */
	readonly via: Via;
}

function contentMisreadingsOf(
	program: Program,
	type: Model,
	claim: Claim,
	rendered: Visibility,
): Misreading[] {
	if (isNamedList(type)) return [];
	const { at: document, ignore, via } = claim;
	const info = metadataInfoOf(program);
	const documentAt = renderedVisibilityOf(program, type, document);
	const renderedAt = renderedVisibilityOf(program, type, rendered);
	const found: Misreading[] = [];
	for (const property of type.properties.values()) {
		if (isNeverType(property.type)) continue;
		const declared = info.isPayloadProperty(property, document, ignore);
		const kept = info.isPayloadProperty(property, renderedAt, ignore);
		const required =
			info.isPayloadProperty(property, documentAt, ignore) &&
			!info.isOptional(property, documentAt);
		const expected = kept && !info.isOptional(property, renderedAt);
		if (declared !== kept || required !== expected) {
			const effect = !declared
				? required
					? "undeclared"
					: "dropped"
				: !kept
					? "added"
					: "reshaped";
			/**
			 * **A key the published schema declares some other way is no misreading**, whether openapi3's
			 * `required` names it or not: a dropped optional key a base or an indexer declares is
			 * accepted where sent, as the document accepts it.
			 */
			if (
				(effect === "undeclared" || effect === "dropped") &&
				declaredElsewhere(program, type, property, rendered, ignore)
			) {
				continue;
			}
			found.push({ model: type, property, at: document, effect, via });
		}
	}
	/**
	 * **A base's schema is part of every subtype's, through `allOf`.** The subtypes here are rendered
	 * with the base's properties written in, not as a reference to the base's declaration, so a base
	 * refused for the schema openapi3 publishes for it left each subtype validating what the document
	 * refuses: `DerivedK` accepted `{id, name}` while its `allOf` held it to a `BaseK` requiring an
	 * `id` it does not declare.
	 */
	const base = type.baseModel;
	const inherited =
		base === undefined
			? []
			: publishedMisreadingsOf(program, base, renderedVisibilityOf(program, base, documentAt));
	/**
	 * **Unless this model declares the key itself**: `D extends B { id: string }` under a `B` whose
	 * `required` names an `id` its properties leave out declares it in its own properties, beside the
	 * `allOf`, and the document holds `D` as declared. Refused for `B`'s schema, `D` refused every
	 * value. Likewise under a `B` that drops an optional `id?` its subtype declares.
	 *
	 * **Each of the base's misreadings, not its first**: `S extends B { k: string }` under a `B`
	 * whose `required` names a `k` and a `bid` its properties leave out declares `k` and not `bid`.
	 * Judged by `k` alone, `S`'s create view was validated as declared, requiring a `bid` that its
	 * sealed `allOf` refuses - accepting what the document refuses.
	 */
	const declaresItself = (misreading: Misreading): boolean =>
		(misreading.effect === "undeclared" || misreading.effect === "dropped") &&
		[...type.properties.values()].some(
			(property) =>
				rawPropertyKey(program, property) === rawPropertyKey(program, misreading.property) &&
				info.isPayloadProperty(property, document, ignore),
		);
	return [...found, ...inherited.filter((misreading) => !declaresItself(misreading))];
}

/**
 * **Whether a key a model's `required` names and its own properties leave out is declared all the
 * same**, so the schema holds a value to it after all: the discriminator of the model declaring it,
 * which openapi3 adds to the properties where they lack it; a base's declaration of the key, through
 * `allOf`; and the indexer that holds every key the model does not name, where it admits the type.
 * Each read as missing, a component the document publishes as declared was refused as
 * `split-visibility`.
 *
 * **A base is judged as its own schema publishes it**, which `allOf` reaches at the visibility the
 * model is reduced to, `rendered`, and openapi3 reads at its own first reference - not at the
 * model's `document`. Read at `Create`, `RBase`'s read-only `id` was missing where the `RBase`
 * the document refers to declares it.
 */
function declaredElsewhere(
	program: Program,
	model: Model,
	property: ModelProperty,
	rendered: Visibility,
	ignore: boolean,
): boolean {
	const key = rawPropertyKey(program, property);
	if (getDiscriminator(program, model)?.propertyName === key) return true;
	const info = metadataInfoOf(program);
	for (let link = model.baseModel; link !== undefined; link = link.baseModel) {
		const at = readVisibilityOf(
			program,
			link,
			renderedVisibilityOf(program, link, rendered),
			ignore,
		);
		for (const each of link.properties.values()) {
			if (rawPropertyKey(program, each) === key && info.isPayloadProperty(each, at, ignore)) {
				return true;
			}
		}
	}
	const binding = bindingIndexerOf(model);
	return (
		binding !== undefined &&
		!isNeverType(binding.value) &&
		isAssignable(program, property.type, binding.value)
	);
}

/**
 * How the schema openapi3 publishes for `type` at `at` differs from that type's schema there, judged
 * against the reference it was written from - see {@link publicationOf}. A component is judged by the
 * one `components.schemas` keeps, the later of the two metadata contexts; a model expression by the
 * one written out in the context it is rendered in, `ignore`. One no reference wrote is still held to
 * its bases'.
 */
function publishedMisreadingOf(
	program: Program,
	type: Model | Union,
	at: Visibility,
	ignore?: boolean,
): Misreading | undefined {
	return publishedMisreadingsOf(program, type, at, ignore)[0];
}

/** Every way the schema openapi3 publishes differs - see {@link publishedMisreadingOf}. */
function publishedMisreadingsOf(
	program: Program,
	type: Model | Union,
	at: Visibility,
	ignore?: boolean,
): Misreading[] {
	if (type.kind !== "Model") return [];
	const claims = view?.publication.get(type)?.get(at) ?? [];
	const claim =
		ignore === undefined ? latestOf(claims) : claims.find((each) => each.ignore === ignore);
	if (claim !== undefined) return contentMisreadingsOf(program, type, claim, at);
	const base = type.baseModel;
	return base === undefined
		? []
		: publishedMisreadingsOf(program, base, renderedVisibilityOf(program, base, at));
}

/**
 * **Whether the schema rendered for `type` here is one openapi3 publishes differently - and if so,
 * `split-visibility`, an error, reported once per declaration.** Refused rather than validated
 * against a schema the document does not hold: the document's `required` names
 * a property its properties leave out, which no value satisfies under `seal-object-schemas`, or it
 * leaves out an optional one, which a sealed schema then refuses.
 *
 * `declared` is the component's name, for a type published as a component; `type` is then its
 * canonical type and `at` the visibility it is declared at. Otherwise `type` is written out where it
 * is used - a model expression, an inlined template instance - and judged by the emission openapi3
 * writes out in the metadata context `ignore`.
 */
export function isSplitByVisibility(
	program: Program,
	type: Type,
	at: Visibility,
	ignore: boolean,
	declared: string | undefined,
): boolean {
	if (type.kind !== "Model" || isArrayLiteral(program, type)) return false;
	const misreading = publishedMisreadingOf(
		program,
		type,
		at,
		declared === undefined ? ignore : undefined,
	);
	if (misreading === undefined) return false;
	if (firstReportOf(program, "split-visibility", type, "")) {
		const own = misreading.model === type;
		const name =
			declared ??
			(type.name === "" ? undefined : getTypeName(type, { namespaceFilter: () => false }));
		const model =
			misreading.model.name === ""
				? "this model expression"
				: `'${getTypeName(misreading.model, { namespaceFilter: () => false })}'`;
		reportDiagnostic(program, {
			code: "split-visibility",
			messageId: !own ? "inherited" : declared === undefined ? "inline" : "default",
			target: type,
			format: {
				name: name ?? "this model expression",
				via: misreading.via.where,
				model,
				property: `'${misreading.property.name}'`,
				at: getVisibilitySuffix(misreading.at & Visibility.All, Visibility.Read),
				effect: EFFECTS[misreading.effect],
				remedy: remedyOf(misreading, model, declared === undefined && own),
			},
		});
	}
	return true;
}

/**
 * **What makes openapi3 publish the request apart: the request's own view of its type.** Measured:
 * `@body body: Create<Outer>` publishes `CreateOuter` and, through it, `CreateInner` and every model
 * the transform reaches - `extends` included - and leaves the shared `Inner` to the responses. Named
 * on the model only, `inner: Create<Inner>` in a model a response returns too would change the
 * response; on the request's root type, nothing but the request changes. A model expression has no
 * name to wrap, so it is named first.
 */
function remedyOf(misreading: Misreading, model: string, expression: boolean): string {
	const template = viewTemplateOf(misreading.at);
	const moved = `, or move '${misreading.property.name}' out of ${model}`;
	const its =
		template === undefined
			? "a model holding only what that request sees"
			: `its '${template}<...>' view`;
	if (expression) return `declare it as a named model and send ${its} in its place${moved}`;
	const { root, where, model: templated, type } = misreading.via;
	if (root !== undefined) {
		// A visibility template takes a model: a union root is sent as a model of its own.
		if (template === undefined || !templated || type === undefined) {
			return `send a model of '${root}' holding only what that request sees as ${where}${moved}`;
		}
		return `${viewRemedyOf(template, type)} and send it as ${where}, through '@body'${moved}`;
	}
	return `send each model in ${where} as ${its}${moved}`;
}

/**
 * Whether openapi3 publishes the component of `type` at `at` split - the refusal
 * {@link isSplitByVisibility} reports, asked without reporting it. A dispatch leaves such a subtype
 * out, as it leaves out one no value is: its validator is `z.never()`, which no
 * `z.discriminatedUnion` can hold.
 */
export function isPublishedSplit(program: Program, type: Type, at: Visibility): boolean {
	return (
		type.kind === "Model" &&
		!shouldInline(program, type) &&
		publishedMisreadingOf(program, type, at) !== undefined
	);
}

const EFFECTS: Readonly<Record<Misreading["effect"], string>> = {
	undeclared: "required and not declared",
	dropped: "not declared",
	added: "declared though it is not part of the schema at 'Read'",
	reshaped: "required where it is optional at 'Read', or optional where it is required",
};

/** The standard template that is a model's view at a request visibility, where there is one. */
/**
 * **The view a remedy names, declared so that it works where it is pasted**: a model of its own,
 * `model OuterCreate is Create<Ns.Outer>;`, with the type spelled from the global namespace. Named
 * `Create<Outer>`, the view inherited `Outer`'s `@friendlyName` and collided with it; spelled by the
 * friendly name, or without its namespace from a sub-namespace, it named nothing; and sent through
 * a spread, `...Create<O1>`, it left the body the document publishes as it was.
 */
export function viewRemedyOf(template: string, type: Type): string {
	const name = "name" in type && typeof type.name === "string" ? type.name : template;
	return `declare 'model ${name}${template} is ${template}<${getTypeName(type)}>;'`;
}

export function viewTemplateOf(at: Visibility): string | undefined {
	switch (at & Visibility.All) {
		case Visibility.Create:
			return "Create";
		case Visibility.Update:
			return "Update";
		case Visibility.Create | Visibility.Update:
			return "CreateOrUpdate";
		case Visibility.Delete:
			return "Delete";
		case Visibility.Query:
			return "Query";
		default:
			return undefined;
	}
}
