import {
	emitFile,
	type EmitContext,
	getDiscriminatedUnion,
	getDiscriminator,
	getDoc,
	getDocData,
	getEncode,
	getLocationContext,
	getSummary,
	getTypeName,
	isErrorModel,
	isNeverType,
	isVoidType,
	navigateProgram,
	type Model,
	NoTarget,
	type Operation,
	type ModelProperty,
	type Program,
	resolvePath,
	type Scalar,
	type Type,
	type Union,
} from "@typespec/compiler";
import {
	getAuthenticationForOperation,
	getVisibilitySuffix,
	isOrExtendsHttpFile,
	Visibility,
	type HttpOperation,
	type HttpOperationParameter,
	type HttpOperationPart,
	type HttpOperationResponse,
	type HttpService,
} from "@typespec/http";
import { getOperationId, resolveOperationId } from "@typespec/openapi";
import { firstReportOf } from "./constraints.js";
import {
	byDeclarationOf,
	inDeclarationOrder,
	inDeclaredOperationOrder,
} from "./declaration-order.js";
import { type EmitterOptions, reportDiagnostic } from "./lib.js";
import { openApiVersionsOf, publishesOpenApi30AndLater } from "./openapi-versions.js";
import { literal } from "./literal.js";
import {
	beginServiceView,
	parameterVisibilityOf,
	publishedComponents,
	publishedTypes,
	requestVisibilityOf,
	unreachedTypes,
	withServiceView,
} from "./published.js";
import { isSingleObjectLiteral, SchemaRegistry, TypeRegistry } from "./registry.js";
import {
	isJsonMediaType,
	isMediaRange,
	isTextualMediaType,
	mediaTypeEssenceOf,
	mediaTypeTypeOf,
	type ResultMember,
	resultMembersOf,
	type StatusKey,
	statusCodesOf,
} from "./results.js";
import { propertyTypeToTs } from "./types.js";
import { resolveStreamModule, streamedTypeOf, withStreamModule } from "./streams.js";
import { resolveVersioningModule, serviceSnapshots } from "./versioning.js";
import {
	EXPLODED_QUERY_SOURCE,
	type EmittedPathSegment,
	type ExpansionShape,
	explodedQueryCall,
	eachReader,
	NO_READERS,
	needsExpansionDecoding,
	routeTemplateOf,
	URI_EXPANSION_SOURCE,
	uriExpansionCall,
	type ValueReaders,
	WIRE_READ_OBJECT_SOURCE,
	WIRE_READ_AS_SOURCE,
	WIRE_READ_SOURCE,
	WIRE_ITSELF_SOURCE,
	WIRE_READERS_SOURCE,
	wireItselfCall,
	wireReadObjectCall,
} from "./uri-template.js";

export type { EmittedPathSegment } from "./uri-template.js";
export { CONTENTLESS_STATUS_CODES, STATUS_CODES } from "./statuses.js";
export {
	type BodyServing,
	isJsonMediaType,
	isMediaRange,
	isTextualMediaType,
	mediaTypeEssenceOf,
	mediaTypeTypeOf,
	type ResponseFacts,
	type ResultMember,
	resultMembersOf,
	type StatusKey,
	statusCodesOf,
} from "./results.js";
import {
	collectExternalImports,
	encodedTypeOf,
	externalReferenceOf,
	holdsRawBytes,
	isExclusive,
	isTypelessMember,
	nullableInnerOf,
	noteDeclaredVocabularies,
	noteKeyVocabularies,
	objectKey,
	objectOfModel,
	reachesItselfThroughUnions,
	refuseExternalReference,
	refuseSelfReachingUnion,
	atItem,
	bindingIndexerOf,
	currentVisibility,
	dispatchedSubtypesOf,
	type PropertyPosition,
	readsFromText,
	renderedVisibilityOf,
	rootVisibilityOf,
	withContractsPackage,
	withSealedObjects,
	withMetadataAnnotationsIgnored,
	requiredReadOnlyIn,
	reportUnpublishable,
	withRequestReading,
	withMultipartBinary,
	withParameterPosition,
	UNREPRESENTABLE,
	withVisibility,
} from "./zod.js";

/**
 * `typespec-http-zod` - Zod validators and framework-free contract types from a TypeSpec HTTP
 * service, agreeing with the OpenAPI document `@typespec/openapi3` publishes from the same source.
 *
 * **The governing rule: if the document cannot say it, the validator must not enforce it.** A
 * validator that checks something the published contract never states is a rule no caller reading
 * that contract can see. This package ships **zero decorators** for exactly that reason - four were
 * deleted, each of which let a spec state something openapi3 could not publish - and asserts the
 * class is empty rather than trusting it. Where openapi3 decides something, its rule is read from its
 * source and copied, refusals included: the same spec has to be representable by both emitters or by
 * neither, or a differential between them means nothing.
 *
 * **Why not `@typespec/http-server-js`.** The first-party JS server emitter is `0.58.0-alpha.*`,
 * self-describes as "highly experimental", and emits a Node.js `http` router. It also answers a
 * different question: this package emits no server at all. Validators are useful to Express, Fastify,
 * Elysia, a Workers fetch handler or a typed client, and a server generator is a thin consumer of
 * them - `typespec-hono` is one.
 *
 * **Built on the stable 1.x surface only** - `$onEmit` plus `@typespec/http` - rather than on
 * `@typespec/emitter-framework` (pre-1.0) or `@typespec/asset-emitter`, which announces its own
 * replacement in its package description. Fewer moving parts under something that has to keep working.
 */
export { $lib } from "./lib.js";

/**
 * The option contract, published so an emitter built on this library can **derive** its own rather
 * than restate it.
 *
 * **Two schemas that have to agree are two lists that will not.** A server generator adds its own
 * keys and forwards the rest; if it restates this one, an option added here is silently rejected as
 * unknown by the wrapper, or accepted and never passed on. Neither failure is visible in output.
 */
export { EmitterOptionsSchema, type EmitterOptions } from "./lib.js";

/**
 * How a property name is spelled as an object key - quoted only when it has to be.
 *
 * **Published because a consumer emitting code beside these validators has to spell keys the
 * SAME way, and getting it wrong produces a file that does not parse.** An unquoted
 * `x-ms-test-header` is exactly that, and it happened: a corpus scenario declares one and the
 * emitted module stopped being loadable. This is not a style choice a second emitter may make
 * independently.
 */
export { jsDocComment, objectKey } from "./zod.js";
/**
 * And the same for a VALUE written into emitted code: a string, enum value or media type as a literal
 * whose source is ASCII. Spec text outside ASCII is the case, and a sibling emitter spelling it with a
 * bare `JSON.stringify` writes the character itself into a file its consumer commits.
 */
export { literal } from "./literal.js";

/** Named once. The emitted banner and the internal-invariant messages both quote it. */
const PACKAGE_NAME = "typespec-http-zod";

/**
 * How to regenerate, for the banner. Set per emission; `undefined` keeps the generic line.
 *
 * Module-scoped rather than threaded through four render functions, matching how the contracts
 * package and the stream module are carried. The emission loop awaits each service to completion
 * before the next begins, so nothing interleaves.
 */
let regenerateHint: string | undefined;

export function beginBanner(hint: string | undefined): void {
	regenerateHint = hint;
}

/**
 * The header every emitted file carries.
 *
 * **`DO NOT EDIT` says what not to do and not what to do instead**, and only the project knows the
 * command that regenerates. Where it states one, the banner carries it; otherwise the generic line
 * stands: recompile the source, do not edit the output, which is true for every project. A
 * generated file is the most-read artefact an emitter produces, and a banner sending the reader to
 * a script they do not have is worse than no instruction at all. The package name stays, because
 * that IS the answer to "what wrote this".
 */
function generatedBanner(): string {
	const second =
		regenerateHint === undefined
			? "// Recompile the spec that produced it; edits here are overwritten on the next run."
			: `// Regenerate with: ${regenerateHint}`;
	return `// GENERATED by ${PACKAGE_NAME} from the TypeSpec service definition. DO NOT EDIT.\n${second}\n`;
}

/**
 * The status a row registers: the first non-error status the operation declares.
 *
 * **"Success" here means "an outcome a handler returns", which includes a redirect.** A range
 * (`2XX`) or a wildcard is not a status a handler can return, so it is not something this emitter can
 * turn into a `respond()` call, and an operation carrying only those is skipped rather than guessed
 * at.
 */
export function successStatusOf(operation: HttpOperation): number | undefined {
	return successStatusesOf(operation)[0];
}

/**
 * **Every** success status the operation declares, ascending.
 *
 * An operation that answers `202` when the work was merely accepted and `200` when it completed
 * inline declares both, and something has to choose. A route with two declared statuses and no way to
 * choose would always answer the first, publishing a status that can never occur; the arm carrying
 * asserts the two stay in step.
 */
export function successStatusesOf(operation: HttpOperation): number[] {
	const codes: number[] = [];
	for (const response of operation.responses) {
		const code = response.statusCodes;
		/**
		 * **2xx AND 3xx, because a redirect is an outcome rather than an error.**
		 *
		 * This accepted 2xx only, so an operation whose one declared response was a `302` had no status,
		 * was skipped by the `continue` in `collectRoutes`, and vanished with no diagnostic. The document
		 * declared the route and the emitted output had no trace of it, so a client generated from that
		 * document would 404 while the compile reported success. A `Location` on a 302 and an OAuth
		 * redirect are the ordinary cases.
		 *
		 * 4xx and 5xx stay out: those are error arms, collected from `@error` models separately, and a
		 * handler does not return one by returning normally.
		 *
		 * **Additive by construction.** Measured across the whole conformance corpus before the change:
		 * ZERO operations declare a response set without a 2xx, so no existing route, count or baseline
		 * moves. Only operations that were being dropped are added.
		 */
		if (typeof code === "number" && code >= 200 && code < 400) codes.push(code);
	}
	return [...new Set(codes)].toSorted((a, b) => a - b);
}

/**
 * **Operation ids, deduplicated the way `@typespec/openapi3` deduplicates them.**
 *
 * `resolveOperationId` derives an id from the immediate parent container, so two interfaces of the
 * same name in different namespaces both resolve to `Standard_primitive`. Every per-operation
 * declaration here is keyed on that id, so colliding ids emitted colliding `const`s:
 * `TS2451: Cannot redeclare block-scoped variable 'Standard_primitiveResponses'`, 72 of them on one
 * conformance scenario, from a compile that reported success.
 *
 * **The document does NOT have this problem, so refusing the spec would be wrong.** Measured on
 * 1.15.0, openapi3 publishes `Standard_primitive` and `Standard_primitive_2` - it deduplicates, and
 * the document is valid. The same source is representable there, so it has to be representable here,
 * and matching its ids is also what keeps the promise that identifiers are named from the operation
 * id the document publishes.
 *
 * The rule is copied from `OperationIdResolver` rather than invented, including the parts that look
 * incidental: an explicit `@operationId` wins and is NOT deduplicated or reserved, and the suffix
 * counts from `_2`. It is not exported, so it is reproduced here and the differential compares the
 * result against the document's own ids.
 */
let operationIds:
	| {
			readonly used: Set<string>;
			readonly assigned: Set<string>;
			readonly cache: Map<Operation, string>;
	  }
	| undefined;

/**
 * Establish a fresh id resolver for one service's emission.
 *
 * **Scoped per SERVICE rather than per walk, because every walk has to name an operation the same
 * way.** `collectRoutes` and `collectRequestTypes` both visit every operation, but each is a separate
 * walk; deduplicating independently would let a suffix depend on the order a walk happened to meet
 * two operations in, and the artefacts would name one operation two ways.
 *
 * A reset rather than a wrapper, because the emission loop is `for (const snapshot of snapshots)`
 * and awaits each service to completion before the next begins. Nothing interleaves, so there is no
 * scope to restore, and wrapping an async body would mean threading a callback through every
 * `emitFile` between the three walks.
 *
 * Left `undefined` outside an emission on purpose: `collectRoutes` is exported and a caller reaching
 * it directly gets `resolveOperationId`'s answer unchanged rather than a suffix that depends on
 * whatever ran before.
 */
function beginOperationIds(): void {
	operationIds = { used: new Set(), assigned: new Set(), cache: new Map() };
}

/** The id this operation is emitted under, unique within the emission. */
function operationIdOf(program: Program, operation: Operation): string {
	const scope = operationIds;
	const resolved = resolveOperationId(program, operation);
	if (scope === undefined) return resolved;
	const cached = scope.cache.get(operation);
	if (cached !== undefined) return cached;
	// An explicit `@operationId` is used as given: openapi3 neither deduplicates nor reserves it.
	const explicit = getOperationId(program, operation) !== undefined;
	let name = resolved;
	if (!explicit && scope.used.has(name)) {
		let count = 1;
		for (;;) {
			count += 1;
			const candidate = `${resolved}_${count}`;
			if (!scope.used.has(candidate)) {
				name = candidate;
				break;
			}
		}
	}
	if (!explicit) scope.used.add(name);
	scope.cache.set(operation, name);
	/**
	 * **Checked after the id is settled, and reachable only through an explicit `@operationId`.** A
	 * derived id is deduplicated against `used` and cannot arrive here twice; an explicit one is never
	 * reserved, so it can equal an id already handed out, in either direction. Reported once per
	 * operation, because the cache above returns before this on every later walk.
	 */
	if (scope.assigned.has(name)) {
		reportDiagnostic(program, {
			code: "duplicate-operation-id",
			format: { operationId: name },
			target: operation,
		});
	}
	scope.assigned.add(name);
	return name;
}

/** The five buckets OpenAPI can express a status RANGE as, in the order it names them. */
const STATUS_RANGE_GROUPS = [1, 2, 3, 4, 5] as const;

/**
 * What the document will key this response under - **openapi3's rule, copied, not re-derived.**
 *
 * **`HttpStatusCodesEntry` is `HttpStatusCodeRange | number | "*"`, and the third case was
 * silently dropped.** A response declared `@minValue(400) @maxValue(499) @statusCode _: int32` is a
 * `4XX` entry in the document and was emitted NOWHERE here: not refused, not warned about, just
 * absent from the arms - so a service could publish a whole class of failures and hand `respond`
 * nothing to check them against. Two of the two operations in `response/status-code-range` lost an
 * arm each this way, and the emitter's own `mixed-error-bodies` refusal was firing over the same
 * scenario for an unrelated and by then obsolete reason, which is how it stayed hidden.
 *
 * **A partial range is REFUSED, because `@typespec/openapi3` refuses it.** `494-499` does not
 * cover the `4XX` bucket, and bucketing it anyway would have the server claim that a `400` carries
 * `ErrorInRange` - a rule no document states, since openapi3 declines to publish a document at all.
 * Agreeing with the reference implementation is the whole point of copying its line: the same spec
 * is either representable by both or by neither.
 *
 * `@defaultResponse` is not tested separately the way openapi3 tests it; `@typespec/http` resolves
 * that decorator to `"*"` before this emitter sees it, so the one check covers both spellings.
 */
function statusKeysOf(program: Program, response: HttpOperationResponse): StatusKey[] {
	const codes = response.statusCodes;
	if (codes === "*") return ["default"];
	if (typeof codes === "number") return [codes];

	const keys: StatusKey[] = [];
	let { start, end } = codes;
	const refuse = (): void => {
		reportDiagnostic(program, {
			code: "unsupported-status-code-range",
			target: response.type,
			format: { start: String(codes.start), end: String(codes.end) },
		});
	};
	if (start < 100) {
		refuse();
		start = 100;
		keys.push("default");
	} else if (end > 599) {
		refuse();
		keys.push("default");
		end = 599;
	}
	for (const group of STATUS_RANGE_GROUPS) {
		if (start > end) break;
		const groupStart = group * 100;
		const groupEnd = groupStart + 99;
		if (start >= groupStart && start <= groupEnd) {
			keys.push(`${group}XX`);
			if (start !== groupStart || end < groupEnd) refuse();
			start = groupStart + 100;
		}
	}
	return keys;
}

/**
 * A header one response declares, as a handler has to supply it.
 *
 * **The WIRE name only.** A result a handler returns is keyed by what the response sets, which is
 * what the document publishes under `responses.<status>.headers`. The TypeSpec property behind it
 * used to be carried beside the name so a runtime could read the value off a flattened result; that
 * made the handler contract depend on a property name the document never states.
 */
export interface EmittedResponseHeader {
	readonly name: string;
	/** The TypeScript type of the value, so a server emitter can put it in a signature. */
	readonly type: string;
	/**
	 * The Zod expression for the value, so a server can check what it is about to send.
	 *
	 * The TYPE above constrains what a handler may return at compile time; this constrains what
	 * actually goes on the wire, which is the same split `schema` and the contract types already make
	 * for a body. A value that crossed a boundary the type system cannot see into - a service binding,
	 * a cast - is exactly what it catches.
	 */
	readonly schema: string;
	/** The document's `required: false`. */
	readonly optional: boolean;
}

/**
 * One response the document declares for an operation, keyed the way the document keys it.
 *
 * **Complete on its own, because a server emitter types a handler's return one member per arm.**
 * The route used to carry these facts in five separate projections - a primary status and body, a
 * list of failure arms, headers for numeric statuses only, media types for numeric statuses only,
 * and a selector for choosing between successes - and each projection had a hole the others did not:
 *
 * - a range or `default` arm never carried its headers or media types;
 * - a second success status carried the FIRST status's body, because the selector assumed one model;
 * - a failure's inline body was an expression nothing outside the arm list could name;
 * - an operation whose only success was a `2XX` range was dropped without a diagnostic.
 *
 * One record per status, built in one pass over `@typespec/http`'s own resolution, has no such gaps
 * to keep in step.
 */
export interface EmittedResponse {
	readonly status: StatusKey;
	/** This status's body, as an emitted Zod expression, or `undefined` where it declares none. */
	readonly schema: string | undefined;
	/**
	 * Every media type the document names for this status, in declaration order.
	 *
	 * Empty exactly when the response carries no body. **A single type is still carried**, because
	 * assuming the one type is JSON is how a `text/plain` arm became indistinguishable from a JSON one.
	 */
	readonly contentTypes: readonly string[];
	readonly headers: readonly EmittedResponseHeader[];
	/**
	 * The body is raw binary, so `schema` is `z.unknown()` - see {@link isRawBinaryMediaType}. A server
	 * serves such a body as bytes or a stream rather than serialising it.
	 */
	readonly binary: boolean;
	/**
	 * The body is a stream of events or lines (`@typespec/streams`). The schema describes the stream as
	 * the document does, a string, which is not something a server validates a stream against.
	 */
	readonly streamed: boolean;
	/**
	 * The body's type is a string, so under a media type that is not JSON it IS the text served.
	 *
	 * **The fact a server needs to serve a non-JSON body at all.** A `string` declared as `text/plain`
	 * is validated and written as is; a MODEL declared as `application/xml` has no serialisation an
	 * emitter can derive from the document, so the text has to come from the application. Forty arms in
	 * the conformance corpus are the second kind and three are the first, and a server that could not
	 * tell them apart would either refuse the text or validate XML against a JSON schema.
	 */
	readonly textual: boolean;
}

/**
 * One response the operation declares, RESOLVED and not yet rendered: its body as a TypeSpec type.
 *
 * **Two walks render the same responses, and they must read one resolution.** The Zod walk turns a
 * body into a schema expression ({@link EmittedResponse}); the contract walk turns it into a
 * TypeScript type for `requests.gen.ts`. The contract walk used to re-derive "the success body" for
 * itself from the lowest success status, which is how `200 Thing | 201 Other` published only `Thing`
 * there while the runtime carried both arms. Each walk now renders these records, so a status one
 * walk can see is a status the other can see.
 */
interface ResolvedResponse {
	readonly status: StatusKey;
	/** The body type, or `undefined` where the status declares none (`void` and `never` included). */
	readonly body: Type | undefined;
	/** An explicit `@body` carrying metadata annotations - see `withMetadataAnnotationsIgnored`. */
	readonly ignoresMetadata: boolean;
	readonly contentTypes: readonly string[];
	/** Each header by WIRE name, with the property it is declared on. */
	readonly headers: readonly { readonly name: string; readonly property: ModelProperty }[];
	/** See {@link EmittedResponse.binary}. */
	readonly binary: boolean;
	/** See {@link EmittedResponse.streamed}. */
	readonly streamed: boolean;
	/** See {@link EmittedResponse.textual}. */
	readonly textual: boolean;
}

/**
 * Every response the operation declares, one per status key, in the order they were RESOLVED.
 *
 * **Each response's own body, headers and media types, and nothing borrowed from another.** The
 * failure arms used to be collected here separately from the success, and before that every failure
 * carried the service-wide error schema: `@error model NotAuthorized { ...ProblemDetails;
 * @statusCode 401 }` is published as `$ref: NotAuthorized`, and `response/status-code-range`
 * gives two operations whose `default` is a different model from every other failure they declare.
 * Reading each status's own response answers both, and is why nothing here believes a service has
 * one error shape or one success shape.
 *
 * Where two responses resolve to the same status the first body wins, which is what the document
 * does, and media types and headers are the union across them.
 *
 * Resolution order, not precedence order, because a renderer that declares components has to
 * declare them in the order they were always declared; {@link inPrecedenceOrder} sorts.
 *
 * **Resolved once per operation, and every walk reads that record.** Resolving reports what the
 * document cannot publish, such as a status range OpenAPI cannot key; the route walk and the contract
 * walk each resolved the same operation, so with contracts emitted every such error was raised twice.
 */
function resolvedResponsesOf(
	program: Program,
	operation: HttpOperation,
): readonly ResolvedResponse[] {
	const resolved = resolvedResponses.get(operation);
	if (resolved !== undefined) return resolved;
	const fresh = resolveResponses(program, operation);
	resolvedResponses.set(operation, fresh);
	return fresh;
}

const resolvedResponses = new WeakMap<HttpOperation, readonly ResolvedResponse[]>();

function resolveResponses(program: Program, operation: HttpOperation): ResolvedResponse[] {
	const byStatus = new Map<
		string,
		{
			readonly status: StatusKey;
			body: Type | undefined;
			ignoresMetadata: boolean;
			readonly contentTypes: Set<string>;
			readonly headers: { readonly name: string; readonly property: ModelProperty }[];
			streamed: boolean;
			file: boolean;
		}
	>();
	for (const response of operation.responses) {
		for (const status of statusKeysOf(program, response)) {
			const key = String(status);
			const entry = byStatus.get(key) ?? {
				status,
				body: undefined,
				ignoresMetadata: false,
				contentTypes: new Set<string>(),
				headers: [],
				streamed: false,
				file: false,
			};
			for (const content of response.responses) {
				reportNeverBody(program, operation, content.body, `${key} response`);
				const body = presentBody(content.body);
				if (entry.body === undefined && body?.bodyKind === "single") {
					entry.body = body.type;
					entry.ignoresMetadata = ignoresMetadata(body);
				}
				/**
				 * **An `Http.File` response's body is its contents, served as bytes.** The same reading
				 * as a file request body: a media type and nothing to serialise. Read only for
				 * `"single"`, every download in `type/file` declared `image/png` and was served empty.
				 */
				if (entry.body === undefined && body?.bodyKind === "file") {
					entry.body = body.contents.type;
					entry.file = true;
				}
				for (const contentType of body?.contentTypes ?? []) {
					entry.contentTypes.add(contentType);
				}
				for (const [name, property] of Object.entries(content.headers ?? {})) {
					if (entry.headers.some((existing) => existing.name === name)) continue;
					entry.headers.push({ name, property });
				}
			}
			if (streamedTypeOf(program, response.type) !== undefined) entry.streamed = true;
			byStatus.set(key, entry);
		}
	}
	return [...byStatus.values()].map((entry) => {
		const contentTypes = [...entry.contentTypes];
		return {
			status: entry.status,
			body: entry.body,
			ignoresMetadata: entry.ignoresMetadata,
			contentTypes,
			headers: entry.headers,
			binary:
				entry.file ||
				(entry.body !== undefined &&
					isBinaryPart(program, entry.body) &&
					isRawBinaryMediaType(contentTypes)),
			streamed: entry.streamed,
			textual: !entry.file && entry.body !== undefined && isStringType(entry.body),
		};
	});
}

/** Responses in OpenAPI's precedence order: exact codes, then ranges, then `default`. */
function inPrecedenceOrder<R extends { readonly status: StatusKey }>(responses: readonly R[]): R[] {
	return responses.toSorted(
		(a, b) =>
			statusPrecedenceOf(a.status) - statusPrecedenceOf(b.status) ||
			statusOrderOf(a.status) - statusOrderOf(b.status),
	);
}

/** A response header's contract type: a header, as a parameter is - see `withParameterPosition`. */
function headerTypeOf(program: Program, property: ModelProperty): string {
	return withParameterPosition(true, () => propertyTypeToTs(program, property));
}

/**
 * Every response the operation declares, rendered as Zod, in OpenAPI's precedence order.
 *
 * Every header is rendered before any body, and bodies in precedence order, which is the order this
 * has always declared components in: the emitted files do not move because the resolution moved.
 *
 * Call inside `withVisibility(Visibility.Read, ...)`: a response is read at `Read`, and
 * resolving it under a request visibility declares components under the wrong suffix.
 */
function responsesOf(
	program: Program,
	operation: HttpOperation,
	registry: SchemaRegistry,
): EmittedResponse[] {
	const withHeaders = resolvedResponsesOf(program, operation).map((response) => ({
		response,
		headers: response.headers.map(({ name, property }): EmittedResponseHeader => ({
			name,
			/**
			 * **Encode-aware, as the schema beside it is.** `@encode(seconds, int32)` makes a `duration`
			 * an integer on the wire, and the header schema checks an integer; reading the declared type
			 * alone published `string`, so a handler satisfying its own result type was refused by its
			 * own header check and the arm could not be returned without a cast.
			 */
			type: headerTypeOf(program, property),
			/**
			 * **The Zod expression, which used to be discarded here.** Every REQUEST parameter goes
			 * through `expressionForProperty` a few hundred lines below; a response header went
			 * through `typeToTs` and nothing else, so the emitted arm carried a name and an
			 * optionality and no way to check a value. A response body that breaks its schema throws
			 * `ResponseContractError`; a header that breaks its own was served.
			 */
			schema: registry.expressionForProperty(property),
			optional: property.optional,
		})),
	}));
	return inPrecedenceOrder(
		withHeaders.map(({ response, headers }) => ({ status: response.status, response, headers })),
	).map(({ response, headers }) => ({
		status: response.status,
		schema:
			response.body === undefined
				? undefined
				: response.binary
					? "z.unknown()"
					: withMetadataAnnotationsIgnored(response.ignoresMetadata, () =>
							registry.expressionFor(response.body as Type, true),
						),
		contentTypes: response.contentTypes,
		headers,
		binary: response.binary,
		streamed: response.streamed,
		textual: response.textual,
	}));
}

/**
 * Where an arm sits in OpenAPI's own precedence order.
 *
 * **The specification decides this, not this emitter.** The Responses Object says a range MAY be
 * given as an uppercase `X` wildcard, and that "if a response is defined using an explicit code, the
 * explicit code definition takes precedence over the range definition for that code". `default` is by
 * definition every status not otherwise listed, so it is last. Emitting the arms already sorted is
 * what lets a consumer take the first match and be right - the alternative is every application
 * re-deriving the rule, and getting it wrong quietly when a range and an exact code both apply.
 */
function statusPrecedenceOf(status: StatusKey): number {
	if (status === "default") return 2;
	return typeof status === "number" ? 0 : 1;
}

/**
 * Whether a type's values are strings: `string` or a scalar built on it, a string literal or template,
 * or a union of those.
 *
 * Read from the type rather than from the emitted schema, which would be a decision made by matching
 * generated text - `z.iso.datetime()` is a string and does not begin with `z.string`.
 */
function isStringType(type: Type): boolean {
	switch (type.kind) {
		case "String":
		case "StringTemplate":
			return true;
		case "Scalar":
			for (
				let scalar: Scalar | undefined = type;
				scalar !== undefined;
				scalar = scalar.baseScalar
			) {
				if (scalar.name === "string") return true;
			}
			return false;
		case "Union":
			return [...type.variants.values()].every((variant) => isStringType(variant.type));
		default:
			return false;
	}
}

/** Ascending within one precedence class, so the order does not depend on declaration order. */
function statusOrderOf(status: StatusKey): number {
	if (typeof status === "number") return status;
	return status === "default" ? 0 : Number(status.charAt(0));
}

/**
 * Whether the operation declares `@useAuth(NoAuth)` - no caller is established for it.
 *
 * **`@useAuth(NoAuth)` reaches OpenAPI as `security: []`, which is why this is derivable at all.**
 * Whether an operation needs a caller is a contract fact the document publishes. What a server
 * requires of that caller beyond its schemes and scopes is not: no OpenAPI keyword expresses it, and
 * a server emitter that guesses is enforcing something no document states.
 */
/**
 * One requirement the document publishes: scheme name to the scopes it demands.
 *
 * Satisfying **any one** requirement authorises a caller, and every scheme WITHIN a requirement must
 * be satisfied together -- which is what an array of OpenAPI `security` objects means, and why this
 * is published as a list of lists rather than a flat set of scopes.
 */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

/**
 * Everything the document says about authenticating an operation, read ONCE.
 *
 * **`scopes` and a boolean `noAuth` were two lossy projections of this, each with its own read of the same
 * fact.** A flat scope union cannot say which scheme demanded what, so an emitter that wanted the
 * gate the document actually publishes had to call `getAuthenticationForOperation` a third time and
 * rebuild the requirements itself -- which is what both server emitters were doing, in two
 * hand-written copies of one rule.
 *
 * `scopes` is unchanged in meaning and is now derived from `security` rather than separately read:
 * the union of every scope any requirement demands, which is what it always was.
 */
function authenticationFor(
	program: Program,
	operation: HttpOperation,
): {
	security: SecurityRequirement[];
	scopes: string[];
	authentication: "none" | "optional" | "required";
} {
	const options = getAuthenticationForOperation(program, operation.operation)?.options ?? [];
	const security: SecurityRequirement[] = [];

	for (const option of options) {
		const requirement: Record<string, readonly string[]> = {};
		let anonymous = false;
		for (const scheme of option.schemes) {
			/**
			 * **`NoAuth` inside an option means that option needs nothing**, which is how a spec says
			 * authentication is optional here. It is not a scheme to demand, and publishing it as one
			 * would make an emitter refuse the anonymous callers the document permits.
			 */
			if (scheme.type === "noAuth") {
				anonymous = true;
				continue;
			}
			/** Scopes belong to the flows of an OAuth2 scheme; every other kind has none. */
			requirement[scheme.id] =
				scheme.type === "oauth2"
					? [...new Set(scheme.flows.flatMap((flow) => flow.scopes.map((scope) => scope.value)))]
					: [];
		}
		/**
		 * **An option that needs nothing is published as `{}`, and kept.** `NoAuth | X` is
		 * `security: [{}, { X: [] }]` in the document `@typespec/openapi3` writes from the same program,
		 * and `{}` is the requirement every caller satisfies. Dropping it published `[{ X: [] }]`, a
		 * contract that refuses the anonymous caller the document accepts.
		 */
		if (anonymous || Object.keys(requirement).length > 0) security.push(requirement);
	}

	const scopes = [...new Set(security.flatMap((requirement) => Object.values(requirement).flat()))];
	const anonymous = security.some((requirement) => Object.keys(requirement).length === 0);
	const real = security.some((requirement) => Object.keys(requirement).length > 0);
	return {
		security,
		scopes,
		authentication: !real ? "none" : anonymous ? "optional" : "required",
	};
}

/**
 * The body every `@error` response in the service declares, when they all declare the same one.
 *
 * **The emitter does not know what a problem document is, and must not.** This is the general
 * capability - "a service may declare an error response; emit its validator so the runtime can check
 * what it sends" - which is what makes it reusable by any server built on this emitter rather than a
 * special case for one error format. An RFC 9457 problem document is one common choice for that slot.
 *
 * **This used to be an INVARIANT the emitter enforced, and it is now merely an observation.** It
 * reported `mixed-error-bodies` - an error, aborting the compile - whenever a service declared two
 * catch-all bodies, or a specific status whose body neither was nor spread the catch-all one. That
 * was a real constraint while every failure arm carried this single schema; now each declared
 * response resolves its own, and a service answering `404` with `NotFoundError` and everything else
 * with `DefaultError` is an ordinary contract that the generated server serves correctly.
 *
 * So the refusal is gone, and what remains is a convenience: the module-level `GENERATED_ERROR_SCHEMA`
 * the route table publishes, which exists precisely when the service has one such body. Where it does
 * not, the constant is not emitted - and a consumer importing it gets a missing export, named at the
 * import, which is the honest report of "there is no such thing here".
 */
export function errorBodyOf(program: Program, service: HttpService): Type | undefined {
	const canonical = new Set<Type>();
	const specific = new Set<Type>();
	for (const operation of service.operations) {
		for (const response of operation.responses) {
			/**
			 * `@error` sits on the RESPONSE type, which is not always the body type.
			 *
			 * Two declaration styles are both idiomatic and both occur. One returns the error model bare
			 * (`op x(): Foo | ProblemDetails`), so response type and body type are the same; the other wraps
			 * it (`@error model ErrorResponse { @statusCode ...; @body body: Problem }`), so the `@error` is
			 * on the wrapper and the body is a plain model. Testing the body missed the second style
			 * entirely.
			 */
			if (!isErrorModel(program, response.type)) continue;
			for (const content of response.responses) {
				const body = content.body;
				if (body?.bodyKind !== "single") continue;
				/**
				 * **An error response can declare no body either.** `tsp-openapi3` renders a bare
				 * `default` response as `DefaultResponse<Body = void>`, so the Swagger Petstore reaches
				 * here with the `void` intrinsic - which was then registered as the service's error schema
				 * and refused by the Zod walk. There is nothing there to validate.
				 */
				const type = bodyTypeOf(body.type);
				if (type === undefined) continue;
				// `"*"` is what `@error` resolves to when the model declares no status - the operation's
				// general "any failure" contract, and the shape the runtime constructs.
				(response.statusCodes === "*" ? canonical : specific).add(type);
			}
		}
	}
	/**
	 * Two catch-all bodies means there is no "the" service-wide error body, so there is nothing to
	 * publish - which is a reason to emit no constant, not a defect to refuse. Each operation's own
	 * `default` arm carries its own schema, and that is what the server validates against.
	 */
	if (canonical.size > 1) return undefined;
	const [body] = canonical;
	if (body !== undefined) return body;
	/**
	 * A service can decline to declare a catch-all and still have one error shape - ten specific
	 * statuses carrying one problem model between them. That is a service-wide
	 * body by any honest reading. Two different ones is not, and picking the first would be naming a
	 * contract fact by iteration order.
	 */
	return specific.size === 1 ? [...specific][0] : undefined;
}

/**
 * A response's body type, or `undefined` where it declares no body.
 *
 * **`void` and `never` ARE "no body", wherever they appear.** Answering that in one place is the
 * whole point: the fact reached this emitter by three different roads and each one had to learn it
 * separately otherwise. A `204` with no content at all; an `op remove(): void`; and - the road that
 * actually broke the Swagger Petstore - `tsp-openapi3` writing a `default` error response as
 * `DefaultResponse<Body = void>`. Returned as a type, any of them is walked and refused with
 * `Cannot emit Zod for Intrinsic: 'void' has no runtime representation'`.
 */
function bodyTypeOf(type: Type): Type | undefined {
	return isVoidType(type) || isNeverType(type) ? undefined : type;
}

/**
 * **A body declared `never` is refused**, as `never-body`, once per declaration.
 *
 * `never` has no values, so the body cannot exist - and `@typespec/openapi3`, whose body paths test
 * only for `void`, publishes it as `content: { "application/json": { schema: {} } }`: any value. A
 * validator can agree with that or with the spec, not both, so the declaration is refused the way
 * `undeclared-discriminator` refuses a discriminator the document cannot state. `void` says "no
 * body", and openapi3 publishes it as none.
 */
/**
 * **A request holding a required read-only property, where openapi3 publishes 3.0 and a later
 * version** - see `ambiguous-read-only`. The 3.0 document lets the request leave it out and the later
 * one does not, so no request validator agrees with both.
 */
function reportAmbiguousReadOnly(program: Program, type: Type, requested: Visibility): void {
	if (!publishesOpenApi30AndLater(program)) return;
	const property = requiredReadOnlyIn(
		program,
		type,
		rootVisibilityOf(program, type, requested),
		new Set(),
	);
	if (property === undefined || !firstReportOf(program, "ambiguous-read-only", type)) return;
	reportDiagnostic(program, {
		code: "ambiguous-read-only",
		target: type,
		format: {
			type: getTypeName(type),
			property:
				property.model === undefined
					? property.name
					: `${getTypeName(property.model)}.${property.name}`,
			later: openApiVersionsOf(program)
				.filter((version) => !version.startsWith("3.0."))
				.map((version) => `OpenAPI ${version}`)
				.join(" and "),
			view: `${getVisibilitySuffix(requested, Visibility.Read)}<${getTypeName(property.model ?? type)}>`,
		},
	});
}

function reportNeverBody(
	program: Program,
	operation: HttpOperation,
	body:
		| { readonly bodyKind: string; readonly type: Type; readonly property?: ModelProperty }
		| undefined,
	position: string,
): void {
	if (body?.bodyKind !== "single" || !isNeverType(body.type)) return;
	const target = body.property ?? operation.operation;
	if (!firstReportOf(program, "never-body", target)) return;
	reportDiagnostic(program, {
		code: "never-body",
		target,
		format: { operationId: operationIdOf(program, operation.operation), position },
	});
}

/**
 * A declared body as the wire carries it: `undefined` where it is `void` or `never`, so no media
 * type is listed for it either.
 *
 * **`@typespec/http` keeps a body it was told is empty**, media types and all, whenever the response
 * or request declares it explicitly - `@statusCode _: 409; @body body: void`. Every artefact read
 * the media types off it, so a 409 with no body was published as `contentTypes:
 * ["application/json"]` and `schema: undefined`, which a consumer reads as a body it cannot validate,
 * and a `void` request body reached the Zod walk and refused the compile. openapi3 publishes no
 * `content` for `void`. A `never` body is refused, as `never-body`, so no artefact states a body the
 * document publishes as any value; see {@link reportNeverBody}.
 */
function presentBody<B extends { readonly bodyKind: string; readonly type: Type }>(
	body: B | undefined,
): B | undefined {
	return body?.bodyKind === "single" && bodyTypeOf(body.type) === undefined ? undefined : body;
}

/** The operation's request body, absent where it is declared `void` or `never`. */
function requestBodyParameterOf(operation: HttpOperation): HttpOperation["parameters"]["body"] {
	return presentBody(operation.parameters.body);
}

/**
 * **The operation's parameters as the document publishes them: every one but a `never`.** openapi3
 * leaves a parameter of type `never` out of the operation (`getParameterOrRef`), required or not and
 * wherever it is, so `?a=1` beside `@query a?: never` is an extra parameter the document accepts.
 * Read whole, each was validated as `z.never()`, which refused it, was typed `a?: never` in the
 * handler's input, and was reported as `unsupported-type` at `<unknown location>:1:1` under a remedy
 * saying a `never` could not get there. A `never` body property is dropped the same way - see
 * `publishedPropertiesOf`. A `never` sharing its wire name with another parameter leaves the name
 * to that one, which is the one the document publishes.
 */
function publishedParametersOf(
	operation: HttpOperation,
): HttpOperation["parameters"]["parameters"] {
	return operation.parameters.parameters.filter((parameter) => !isNeverType(parameter.param.type));
}

/**
 * The media types this operation's success response can be served as.
 *
 * **The fact that decides whether two operations are a collision or a CHOICE.** TypeSpec models
 * content negotiation as several operations on one route, each accepting a different media type;
 * OpenAPI models it as one path entry whose response lists them all. This emitter read neither, so
 * it registered every operation and Hono - which matches in registration order - left all but the
 * first as dead code that looks mounted.
 *
 * Empty when the response carries no body, which is not the same as a body served as anything.
 */
function responseContentTypesOf(operation: HttpOperation, status: number): string[] {
	const types = new Set<string>();
	for (const response of operation.responses) {
		if (response.statusCodes !== status) continue;
		for (const content of response.responses) {
			for (const contentType of presentBody(content.body)?.contentTypes ?? []) {
				types.add(contentType);
			}
		}
	}
	return [...types];
}

/**
 * The type a parameter actually crosses the wire as, after any `@encode` on the property.
 *
 * **Read through `encodedTypeOf`, the rule the parameter's schema is built by.** This read
 * `getEncode(...).type` directly, which for an array encoding on a query parameter is `string`: the
 * schema kept the declared `int32[]`, as the document does, while the element decoder found no list
 * and left `"1"` to meet `z.int32()`. Every path here that decides how a value is split, decoded or
 * expanded reads this type, so none of them can disagree with the schema it feeds.
 */
function encodedParameterType(program: Program, property: ModelProperty): Type {
	const type = encodedTypeOf(program, property) ?? property.type;
	/**
	 * **A parameter cannot carry `null` on the wire, so `T | null` arrives as a `T`.** Read as the
	 * union, `?ids=1,2` for `ids?: int32[] | null` was never split or decoded, and a form-exploded
	 * `filter?: Filter | null` was never gathered, so its keys were stripped.
	 */
	return nullableInnerOf(type) ?? type;
}

/**
 * An ARRAY parameter's element type, or `undefined` where it is not such an array.
 *
 * `?ids=1,2,3` splits into strings, so each element is read from text as a lone scalar is.
 */
function elementOf(type: Type): Type | undefined {
	return isArrayType(type) && type.kind === "Model" ? type.indexer?.value : undefined;
}

/** Whether a type is an array - TypeSpec models one as a `Model` carrying an integer indexer. */
function isArrayType(type: Type): boolean {
	return type.kind === "Model" && type.indexer?.key.name === "integer";
}

/**
 * The Zod for a **multipart** request body, built from its parts.
 *
 * **`requestBodyOf` returns a type only for `bodyKind === "single"`, so every multipart operation
 * was mounted with NO body validator at all** - 19 routes across `payload/multipart` and 12
 * components the document declares that nothing here could check. Not a refusal, not a diagnostic:
 * silently unvalidated, which is the failure mode this emitter exists to remove.
 *
 * `HttpPart<T>` is unwrapped to `T`, which is what the document publishes - `HttpPart<string>` is
 * `{type: "string"}` and `HttpPart<Address>` is a `$ref`.
 *
 * **A binary part is `z.unknown()`, deliberately.** `SCALARS` maps `bytes` to `z.string()`, which
 * is right for a JSON body (base64) and wrong here: in a multipart part `bytes` is raw binary, and
 * openapi3 publishes `{}` for it - no type at all. Emitting `z.string()` would enforce a rule the
 * document does not state AND reject what a server actually receives, since `c.req.parseBody()`
 * hands back a `File`. The type of a value is positional, exactly as its visibility is.
 */
/**
 * The TS type for a **multipart** request body, built from the same parts as its validator.
 *
 * **`requestBodyOf` returns a type only for `bodyKind === "single"`, so a multipart body reached the
 * request type not at all.** Measured: `UploadInput` was `{ "Content-Type": "multipart/form-data" }`
 * while the validator beside it was `z.object({ file: ..., alt: ... })` and the document published
 * every part. Two artefacts from one program, contradicting each other.
 *
 * **Built from `body.parts`, not from the parts model.** Walking the model types each part as its
 * `HttpPart<T>` wrapper - `file: {}` - where the validator unwraps to `T`. Mirroring
 * {@link multipartSchemaOf} part for part, including `multi` as an array, `optional`, and a binary
 * part as `unknown`, is what makes the two agree by construction rather than by coincidence.
 */
function multipartTsOf(
	program: Program,
	body: { readonly parts: readonly HttpOperationPart[]; readonly type?: Type },
	registry: TypeRegistry,
): string {
	const entries = body.parts.map((part) => {
		const type = part.body?.type;
		const inner =
			type === undefined
				? "unknown"
				: isFilePart(program, type)
					? MULTIPART_FILE
					: isBinaryPart(program, type)
						? "unknown"
						: withMetadataAnnotationsIgnored(ignoresMetadata(part.body), () =>
								withMultipartBinary(holdsRawBytes(program, type), () =>
									registry.expressionFor(type, true),
								),
							);
		const value = part.multi === true ? `(${inner})[]` : inner;
		const optional = part.optional === true ? "?" : "";
		return `\t${objectKey(part.name ?? "")}${optional}: ${value};`;
	});
	const shape = entries.length === 0 ? "{}" : `{\n${entries.join("\n")}\n}`;
	// Declared under the component's name, as its validator is - see `multipartSchemaOf`.
	const name = multipartNameOf(body);
	return name === undefined || body.type === undefined
		? shape
		: registry.declareNamed(name, () => shape, body.type);
}

/** The component openapi3 publishes a multipart body as: its model's name, where it has one. */
function multipartNameOf(body: { readonly type?: Type }): string | undefined {
	const named = body.type;
	return named !== undefined && named.kind === "Model" && named.name !== ""
		? named.name
		: undefined;
}

function multipartSchemaOf(
	program: Program,
	body: { readonly parts: readonly HttpOperationPart[]; readonly type?: Type },
	registry: SchemaRegistry,
): string {
	const entries = body.parts.map((part) => {
		const type = part.body?.type;
		// `.exactOptional()` for the same reason as a model property: `parseBody` yields present keys
		// only, so an absent part is an absent key rather than an explicit `undefined`.
		const entry = (value: string): string =>
			`\t${objectKey(part.name ?? "")}: ${part.optional === true ? `${value}.exactOptional()` : value},`;
		if (isJsonListPart(program, part)) return entry(jsonListDecoded(jsonListOf(registry, part)));
		/**
		 * **A form carries text, so a part that means a number or a boolean is decoded first**, by the
		 * same rule {@link wireDecoded} applies to path, query and header values: `"0.5"` becomes
		 * `0.5`, and text that is not a well-formed number is passed on unchanged to fail against the
		 * schema the document publishes. `c.req.parseBody()` hands a text part over as a string, so
		 * `z.number()` alone refused every conformant request; measured on `@typespec/http-specs`
		 * `payload/multipart/non-string-float`, a 400 for the request the scenario documents.
		 */
		const inner =
			type === undefined
				? "z.unknown()"
				: isFilePart(program, type)
					? `z.unknown().refine(${MULTIPART_FILE_REFINEMENT})`
					: isBinaryPart(program, type)
						? "z.unknown()"
						: holdsRawBytes(program, type)
							? /**
								 * Any value but what its other members refuse, and no text to read - unless the
								 * document publishes the part as JSON alone, `HttpPart<bytes | null>`, where its
								 * text is JSON and `x` is refused.
								 */
								withMultipartBinary(true, () =>
									isJsonPart(part)
										? jsonTextDecoded(registry.expressionFor(type, true))
										: registry.expressionFor(type, true),
								)
							: withMetadataAnnotationsIgnored(ignoresMetadata(part.body), () =>
									isJsonPart(part)
										? jsonTextDecoded(registry.expressionFor(type, true))
										: isJsonOrTextPart(part)
											? jsonOrTextDecoded(
													registry.expressionFor(type, true),
													textPartDecoded(program, registry, type),
												)
											: textPartDecoded(program, registry, type),
								);
		if (part.multi !== true) return entry(inner);
		// `multi` is `HttpPart<T>[]` - the same part repeated, which the document publishes as a list,
		// and one whose text may be JSON is that list in JSON as well - see `mayBeJsonList`.
		return entry(
			isJsonOrTextPart(part)
				? jsonOrTextDecoded(jsonListOf(registry, part), `z.array(${inner})`)
				: `z.array(${inner})`,
		);
	});
	const shape = entries.length === 0 ? "z.object({})" : `z.object({\n${entries.join("\n")}\n})`;
	/**
	 * Declared under the model's own name when it has one, because the document publishes a component
	 * for it. Emitted inline the schema is correct and the component still has no validator, which the
	 * differential reports - rightly - as a contract the runtime cannot check.
	 */
	const name = multipartNameOf(body);
	return name === undefined || body.type === undefined
		? shape
		: registry.declareNamed(name, () => shape, body.type);
}

/**
 * **What a text part's value is read as: never `null`, which text does not spell**, so `T | null`
 * is read as a `T`, as a parameter's is - see `encodedParameterType`. Read as the union, `h=1&h=2`
 * for `int32[] | null` under `text/plain` reached `z.array(z.int32())` as `["1", "2"]` unread, and
 * was refused where the document reads `[1, 2]`.
 */
function asText(type: Type): Type {
	return nullableInnerOf(type) ?? type;
}

/** The parts read from text - see {@link EmittedRoute.textParts}. */
function textPartsOf(
	program: Program,
	body: { readonly parts: readonly HttpOperationPart[] },
): { readonly name: string; readonly json: boolean }[] {
	return body.parts.flatMap((part) => {
		const type = part.body?.type;
		if (part.name === undefined || type === undefined) return [];
		if (isFilePart(program, type) || isBinaryPart(program, type) || holdsRawBytes(program, type)) {
			return [];
		}
		return [{ name: part.name, json: isJsonPart(part) }];
	});
}

/**
 * **A text part of a union holding a list is one value, or several sent as as many parts**, read as a
 * URL-encoded form's field is - see `readerOf`: `int32 | int32[]` under `text/plain` is `5` sent
 * once and `[1, 2]` sent as `1` and `2`, and `int32 | string[]` reads a lone `a` as the list `["a"]`.
 * Read against the whole union, as one text is, the parts reached it unread and were refused where
 * the document reads `[1, 2]`. Rendered as a part's schema is, where a parameter's refuses a tuple.
 */
function textPartDecoded(program: Program, registry: SchemaRegistry, type: Type): string {
	const declared = registry.expressionFor(type, true);
	const inner = asText(type);
	const forms = inner.kind === "Union" ? wireFormsOf(inner) : [];
	const lists = forms.filter((each) => elementOf(each) !== undefined);
	if (lists.length === 0) return wireDecoded(program, registry, declared, inner);
	const each = lists.map((list) =>
		atItem(program, list as Model, () => registry.expressionFor(elementOf(list) as Type, true)),
	);
	const one = forms.some((form) => elementOf(form) === undefined) ? declared : undefined;
	return `z.preprocess((raw) => wireReadAs(raw, ${eachReader(each, one, declared)}), ${declared})`;
}

/**
 * **A part the document publishes as a list under a media type that is not JSON alone is that many
 * parts**, one per element, however the spec declared it: `HttpPart<{ @header contentType:
 * "text/plain"; @body body: int32[] }>` is published exactly as `HttpPart<int32>[]` is, `{ type:
 * array, items: int32 }` with `contentType: text/plain`, and text spells no list. Read as one part,
 * a lone `5` reached `z.array` as `"5"` and was refused, where the same part declared repeated read
 * it as `[5]`. A JSON part's text may spell the whole list as well - see {@link isJsonListPart}.
 */
function repeatsAsText(part: HttpOperationPart): boolean {
	const type = part.body?.type;
	return (
		part.multi !== true &&
		type !== undefined &&
		!isJsonPart(part) &&
		isArrayType(nullableInnerOf(type) ?? type)
	);
}

/**
 * **A JSON part the document publishes as a list is one list or its elements, however it is
 * declared.** `HttpPart<int32[]>` and `HttpPart<{ @header contentType: "application/json"; @body
 * body: int32 }>[]` are published alike, `{ type: array, items: int32 }` with `contentType:
 * application/json`, and OAS 3.1 does not say whether such a part is sent once, as the list's JSON,
 * or once per element, each element's. So the document admits both: `[1,2]` is the list, and `5`,
 * or `1` and `2` sent as two parts, its elements. Read as declared, the first refused `5` and the
 * two parts, and the second `[1,2]`. A file or raw bytes is no JSON to read.
 */
function isJsonListPart(program: Program, part: HttpOperationPart): boolean {
	const type = part.body?.type;
	return (
		type !== undefined &&
		isJsonPart(part) &&
		!isFilePart(program, type) &&
		!isBinaryPart(program, type) &&
		!holdsRawBytes(program, type) &&
		(part.multi === true || isArrayType(nullableInnerOf(type) ?? type))
	);
}

/**
 * Whether one text of a part the document publishes as a list may be the whole list in JSON: a JSON
 * list part, or one that is text or JSON, published as a list - declared repeated, or as a list under
 * a media type that is not JSON alone. See {@link isJsonListPart} and {@link repeatsAsText}.
 */
function mayBeJsonList(program: Program, part: HttpOperationPart): boolean {
	return (
		isJsonListPart(program, part) ||
		(isJsonOrTextPart(part) && (part.multi === true || repeatsAsText(part)))
	);
}

/** The schema of the list a part is published as, read from JSON: a repeated part's, its elements'. */
function jsonListOf(registry: SchemaRegistry, part: HttpOperationPart): string {
	const declared = withMetadataAnnotationsIgnored(ignoresMetadata(part.body), () =>
		registry.expressionFor(part.body.type, true),
	);
	return part.multi === true ? `z.array(${declared})` : declared;
}

/**
 * **A repeated part sent once is the one-element list the document describes**, and a form hands it
 * over as the one value: `parseBody({ all: true })` makes a list only of a repeated key, so one file
 * sent to a multi-file field reached `z.array` as a file and was refused. Boxed for the request
 * only - the component stays the document's schema, where a lone value is no list - and only what a
 * form delivers for one part, text or a file, so a value no form sends is judged as it is.
 *
 * A part repeats where the document says it does: declared `HttpPart<T>[]`, or published as a list
 * under a text media type - see {@link repeatsAsText}. **One whose text may be JSON is boxed only
 * where its text is not the JSON list the part accepts** - see {@link mayBeJsonList}: `[1,2]` is
 * that list, and `5` the one element.
 */
function multipartRequestOf(
	program: Program,
	registry: SchemaRegistry,
	body: { readonly parts: readonly HttpOperationPart[] },
	schema: string,
): string {
	const named = body.parts.filter((part) => part.name !== undefined);
	const jsonOrText = named.filter((part) => mayBeJsonList(program, part));
	const boxed = named.filter(
		(part) => !mayBeJsonList(program, part) && (part.multi === true || repeatsAsText(part)),
	);
	if (boxed.length === 0 && jsonOrText.length === 0) return schema;
	const one = `typeof value === "string" || (value !== null && typeof value === "object" && !Array.isArray(value) && "arrayBuffer" in value)`;
	const always =
		boxed.length === 0
			? ""
			: ` for (const key of ${literal(boxed.map((part) => part.name as string))}) { const value = boxed[key]; if (${one}) boxed[key] = [value]; }`;
	const lists = jsonOrText.map(
		(part) => `[${literal(part.name as string)}, ${jsonListOf(registry, part)}]`,
	);
	const unlessJson =
		lists.length === 0
			? ""
			: ` for (const [key, list] of [${lists.join(", ")}] as const) { const value = boxed[key]; if (typeof value === "string") { try { if (list.safeParse(JSON.parse(value)).success) continue; } catch { /* text, one element */ } } if (${one}) boxed[key] = [value]; }`;
	return `z.preprocess((raw) => { if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw; const boxed: globalThis.Record<string, unknown> = { ...raw };${always}${unlessJson} return boxed; }, ${schema})`;
}

/**
 * The shape a multipart file part actually arrives as, spelled structurally.
 *
 * **Structural rather than `File`, because emitted output must depend on no ambient library.**
 * `File` is reachable only through `lib.dom` or `@types/node`, and this package's own
 * emitted-output typecheck runs with `types: []` precisely so a dependency like that cannot creep
 * in. The three members are the ones a handler needs and the ones {@link MULTIPART_FILE_REFINEMENT}
 * actually verifies - claiming more would be asserting what nothing established.
 *
 * `arrayBuffer` is a property rather than a method on purpose: `Declared<>` maps the inferred side
 * of the wire assertion, and a mapped type turns a method into a function-typed property, so
 * spelling it this way on both sides is what keeps the two identical.
 */
const MULTIPART_FILE =
	"{ name: string; type: string; arrayBuffer: () => globalThis.Promise<ArrayBuffer> }";

/**
 * The check that makes {@link MULTIPART_FILE} established rather than asserted.
 *
 * **Why this is derivable from the contract, which is the rule `test/vocabulary.test.ts` enforces.**
 * `@typespec/openapi3` publishes a bare `{}` for a `HttpPart<File>`, in 3.1 and even where the part
 * declares a content type. That is OpenAPI's IDIOM for binary content in a multipart body rather
 * than a statement that any value is acceptable, and the transport says the same: Hono types a
 * multipart part as `string | File` and nothing else. So this refuses exactly one thing - a text
 * field where the spec declared a file - which is malformed against the spec that produced the
 * document. A spec meaning "either" writes `HttpPart<File | string>`, so nothing becomes
 * inexpressible; the declaration simply means what it says.
 *
 * **`z.unknown().refine()` rather than `z.custom<T>()`, and the difference is not stylistic.**
 * Measured on zod 4.4.3: `z.toJSONSchema(z.custom(...))` throws `Custom types cannot be represented
 * in JSON Schema`, which silently took four corpus schemas out of the differential comparing these
 * validators against the document. Refined `z.unknown()` serialises to `{}` - exactly what openapi3
 * publishes - so that comparison keeps working. Zod 4 narrows on a type predicate, so the inferred
 * type is the same either way.
 *
 * Every member the type claims is verified, so the narrowing is sound.
 */
const MULTIPART_FILE_REFINEMENT = `(value): value is ${MULTIPART_FILE} => typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && "type" in value && typeof value.type === "string" && "arrayBuffer" in value && typeof value.arrayBuffer === "function"`;

/**
 * A part declared as a `File`, as opposed to raw `bytes`.
 *
 * **Narrower than {@link isBinaryPart} deliberately.** A `File` part is declared to be a file and
 * `c.req.parseBody()` produces one, so the contract supports saying so. `bytes` says only that the
 * payload is binary; a client may legitimately send it as an ordinary form field, which arrives as a
 * string. Widening this to cover `bytes` would refuse payloads that pass today, on an inference the
 * spec never made.
 */
function isFilePart(program: Program, type: Type): boolean {
	// `Http.File` as `@typespec/http` decides it - a spec's own `model File` is a JSON part.
	return type.kind === "Model" && isOrExtendsHttpFile(program, type);
}

/** `bytes`, or a model built on `File` - the parts openapi3 publishes as an empty schema. */
/**
 * Whether a multipart part travels as JSON: every media type `@typespec/http` resolves for it is a
 * JSON one. That is `application/json` for a model or array part, and whatever an explicit
 * `@header contentType` names for a part that declares one.
 */
function isJsonPart(part: HttpOperationPart): boolean {
	const contentTypes = part.body?.contentTypes ?? [];
	return (
		contentTypes.length > 0 &&
		contentTypes.every((contentType) => /^application\/(?:[\w.+-]+\+)?json$/i.test(contentType))
	);
}

/**
 * **A JSON part is decoded from the JSON text a form carries** before the document's schema applies.
 * A client writes the part as text with `Content-Type: application/json` and no filename, so
 * `c.req.parseBody()` hands over a string; the schema alone refused every such request with
 * `expected object, received string`. Text that is not JSON is an issue of its own rather than a
 * string passed on, so a part whose schema admits a string still refuses malformed JSON. A value that
 * is not text is left alone for the schema to judge.
 */
/**
 * **A part whose type mixes text with JSON** - `HttpPart<int32 | Address>` - which the document
 * publishes with `contentType: "text/plain, application/json"`: the client chooses per request, and
 * the form hands over the text either way. JSON is read where the text is JSON the schema accepts, and
 * the text is read as text otherwise; read as text alone, `{"city":"x"}` reached `Address` as a
 * string and was refused. Any JSON value, not an object alone: `"all"`, quoted, is the JSON string
 * `HttpPart<Nums | "all">` accepts, and ` 1` the number.
 */
function isJsonOrTextPart(part: HttpOperationPart): boolean {
	const contentTypes = part.body?.contentTypes ?? [];
	const json = (contentType: string): boolean =>
		/^application\/(?:[\w.+-]+\+)?json$/i.test(contentType);
	return contentTypes.some(json) && !contentTypes.every(json);
}

/**
 * **A body sent as a URL-encoded form, read from the text it carries** - see
 * {@link EmittedRoute.formRequestSchema}. A form holds text, `n=5&b=true`, and the document's schema
 * describes the values it spells, so each field is read against its own schema as a parameter's is,
 * and a key sent more than once is the list it stands for. `only` where the form is the one media
 * type the body is declared under. `undefined` where no form is, or nothing in the body reads.
 *
 * **Each object the body can be is one reading of the form, and the body's whole schema judges
 * every reading**, as the document does: it accepts a form where some reading of its text is a value
 * of the schema it publishes. Read member by member against each member's own schema, a union was
 * rebuilt here beside the one the document publishes, and only a plain union of models ever was:
 * `DU` with no envelope, `DU | null`, `{ DA, string }`, `{ PU, DB }` and `DA | DB | DU` were
 * validated as JSON, so `kind=a&n=5` was refused, "expected number, received string", where the
 * document reads `{ kind: "a", n: 5 }`. A `@oneOf` judged member by member counted differently too:
 * `x=5` against `PA { x?: int32 }` and `PB { x?: string }` matched both, each by its own reading, and
 * was refused where each reading the document takes matches exactly one.
 */
function formBodyOf(
	program: Program,
	registry: SchemaRegistry,
	operation: HttpOperation,
	body: { readonly contentTypes: readonly string[] } | undefined,
	type: Type,
	declared: string,
): { readonly schema: string; readonly only: boolean } | undefined {
	const contentTypes = body?.contentTypes ?? [];
	const form = (contentType: string): boolean =>
		mediaTypeEssenceOf(contentType) === "application/x-www-form-urlencoded";
	if (!contentTypes.some(form)) return undefined;
	const only = contentTypes.every(form);
	const readings = formReadingsOf(program, registry, type);
	if (!readings.some(readsText)) return undefined;
	const ambiguous = ambiguousFormKeyOf(program, type);
	if (ambiguous !== undefined) {
		reportDiagnostic(program, {
			code: "ambiguous-form-reading",
			target: ambiguous.target,
			format: {
				operation: operation.operation.name,
				union: getTypeName(ambiguous.union),
				member: getTypeName(ambiguous.member),
				other: getTypeName(ambiguous.other),
				key: ambiguous.key,
				first: ambiguous.first,
				second: ambiguous.second,
			},
		});
		return { schema: UNREPRESENTABLE, only };
	}
	/**
	 * **A reading that reads nothing is the form as sent, and stays one**: `kind=c&n=5` is a `DC`
	 * whose `n` is a string, and read only as `DA` reads it - `n` the number `5` - it was refused by
	 * `DC | DA`, which accepts it as text.
	 */
	const read = [
		...new Set(
			readings.map((readers) =>
				readsText(readers) ? `z.preprocess(${wireReadObjectCall(readers)}, ${declared})` : declared,
			),
		),
	];
	return {
		schema: read.length === 1 ? (read[0] as string) : `z.union([${read.join(", ")}])`,
		only,
	};
}

/**
 * **Where a `@oneOf` sent as a URL-encoded form depends on a reading no validator can choose.** The
 * document accepts a form where some reading of its text matches exactly one member: each key sent
 * once is a value its text spells - a number, a boolean, the text itself - or the one-element list of
 * one. A member reads each key as the first of those its schema accepts, and the whole union judges
 * that reading - see `formBodyOf`. That agrees with the document unless a member reads a key one way
 * that another member accepts, while accepting another reading the other refuses, and the other's
 * own reading of the form leaves a rival matching too: then which reading matches one member alone
 * depends on every other key and member. `x=5` against `M { x?: int32 | string }` and
 * `N { x?: int32 }` is `{ x: "5" }`, `M` alone, but read as `5` it matched both and was refused;
 * open, `x=all` against `A { x?: int32 | "all" }` and `B { y?: boolean }` is `{ x: ["all"] }`, `B`
 * alone. Finding that reading means trying every combination of every key's readings, exponential in
 * the keys, and a record's keys are the sender's to choose - so the body is refused instead, as
 * `ambiguous-form-reading`. Where no member tells another's readings apart, or the other's reading
 * rules every rival out by a key the rival requires - a `kind` literal - some member's reading is
 * the document's, and the body is validated. See {@link tellsApart}.
 *
 * A discriminated union is no such `oneOf`: its members' discriminators differ, so no reading
 * matches two of them. Nor is a union a form cannot be more than one object of.
 */
function ambiguousFormKeyOf(program: Program, type: Type): FormAmbiguity | undefined {
	const visit = (each: Type, via: ReadonlySet<Type>): FormAmbiguity | undefined => {
		if (each.kind !== "Union" || via.has(each)) return undefined;
		const members = [...each.variants.values()].map((variant) => variant.type);
		if (isExclusive(program, each) && getDiscriminatedUnion(program, each)[0] === undefined) {
			const groups = members
				.map((member) => modelsOf(member, new Set()).map((model) => keyReadingsOf(program, model)))
				.filter((group) => group.length > 0);
			for (const [i, group] of groups.entries()) {
				for (const [j, other] of groups.entries()) {
					if (i === j) continue;
					const rivals = groups.filter((_, k) => k !== j).flat();
					for (const first of group) {
						for (const second of other) {
							const found = tellsApart(first, second, rivals);
							if (found !== undefined) return { union: each, ...found };
						}
					}
				}
			}
		}
		for (const member of members) {
			const found = visit(member, new Set([...via, each]));
			if (found !== undefined) return found;
		}
		return undefined;
	};
	return visit(type, new Set());
}

interface FormAmbiguity {
	readonly union: Union;
	readonly member: Model;
	readonly other: Model;
	readonly target: ModelProperty | Model;
	readonly key: string;
	readonly first: string;
	readonly second: string;
}

/** The objects a member of a union is: itself, or each a union of them reaches. */
function modelsOf(type: Type, seen: Set<Type>): Model[] {
	if (type.kind === "Model") return isArrayType(type) ? [] : [type];
	if (type.kind !== "Union" || seen.has(type)) return [];
	seen.add(type);
	return [...type.variants.values()].flatMap((variant) => modelsOf(variant.type, seen));
}

/**
 * **What a key sent once may be read as, by the kind of text it is**: a mask per class of text - one
 * spelling a number, one spelling a boolean, any other - of the readings accepted: the value it
 * spells, the text itself, and the one-element list of either.
 */
interface FormReadings {
	readonly numeric: number;
	readonly boolean: number;
	readonly other: number;
}

const SPELLED = 1;
const ITSELF = 2;
const SPELLED_LIST = 4;
const ITSELF_LIST = 8;
const NO_READING: FormReadings = { numeric: 0, boolean: 0, other: 0 };
const EVERY_READING: FormReadings = { numeric: 15, boolean: 15, other: ITSELF | ITSELF_LIST };

/** Each class of text, and the value a text of it spells. */
const TEXT_CLASSES = [
	["numeric", "number"],
	["boolean", "boolean"],
	["other", ""],
] as const;

/**
 * How a model reads one key: the readings it accepts, whether its reader reads the key - declared,
 * or held by an indexer - rather than leaving the text as sent, and whether it requires it.
 */
interface KeyReading {
	readonly readings: FormReadings;
	readonly read: boolean;
	readonly required: boolean;
	readonly property?: ModelProperty;
}

interface ModelReadings {
	readonly model: Model;
	readonly keys: ReadonlyMap<string, KeyReading>;
	/** Every key the model does not declare. */
	readonly rest: KeyReading;
}

/** A model's reading of a key: its own, or every undeclared key's. */
function keyOf(readings: ModelReadings, key: string | undefined): KeyReading {
	return (key === undefined ? undefined : readings.keys.get(key)) ?? readings.rest;
}

/**
 * The reading a model's reader takes of a text of one class: the first its schema accepts - see
 * `wireRead` - or the text as sent where it reads none. `0` where the reader takes one the schema
 * refuses, which nothing here relies on.
 */
function choiceOf(reading: KeyReading, kind: keyof FormReadings): number {
	return reading.read ? lowestBit(reading.readings[kind]) : ITSELF;
}

/**
 * **A key `member` reads one way where `other` accepts that reading and refuses another `member`
 * accepts** - and `other`'s own reading of the form no rival of it accepts, so the validator reads
 * the form only as the two do - see {@link ambiguousFormKeyOf}. Where every rival requires a key
 * whose reading by `other` it refuses, `other`'s reading matches `other` alone, and the form is
 * accepted as the document accepts it.
 */
function tellsApart(
	member: ModelReadings,
	other: ModelReadings,
	rivals: readonly ModelReadings[],
): Omit<FormAmbiguity, "union"> | undefined {
	const rescued = rivals.every((rival) =>
		[...rival.keys].some(
			([key, reading]) =>
				reading.required &&
				TEXT_CLASSES.every(([kind]) => {
					const choice = choiceOf(keyOf(other, key), kind);
					return (
						reading.readings[kind] === 0 ||
						(choice !== 0 && (reading.readings[kind] & choice) === 0)
					);
				}),
		),
	);
	if (rescued) return undefined;
	const keys = [...new Set([...member.keys.keys(), ...other.keys.keys()])];
	for (const key of [...keys, undefined]) {
		const mine = keyOf(member, key);
		const yours = keyOf(other, key);
		for (const [kind, spelled] of TEXT_CLASSES) {
			const accepted = mine.readings[kind];
			const choice = choiceOf(mine, kind) & accepted;
			const refused = accepted & ~yours.readings[kind];
			if (choice === 0 || (yours.readings[kind] & choice) === 0 || refused === 0) continue;
			return {
				member: member.model,
				other: other.model,
				target: mine.property ?? yours.property ?? member.model,
				key: key === undefined ? "a key neither declares" : `'${key}'`,
				first: describeReading(choice, spelled),
				second: describeReading(lowestBit(refused), spelled),
			};
		}
	}
	return undefined;
}

function lowestBit(mask: number): number {
	return mask & -mask;
}

function describeReading(bit: number, spelled: string): string {
	switch (bit) {
		case SPELLED:
			return `the ${spelled} it spells`;
		case ITSELF:
			return "itself";
		case SPELLED_LIST:
			return `the list of the ${spelled} it spells`;
		default:
			return "the list of itself";
	}
}

/** Each key a model declares, read as its validator holds it, and every other key's reading. */
function keyReadingsOf(program: Program, model: Model): ModelReadings {
	return withVisibility(renderedVisibilityOf(program, model, currentVisibility()), () => {
		const object = objectOfModel(program, model);
		const keys = new Map<string, KeyReading>();
		const none: KeyReading = { readings: NO_READING, read: false, required: false };
		if (object.kind !== "object") return { model, keys, rest: none };
		for (const member of object.members) {
			if (member.property === undefined) continue;
			keys.set(member.key, {
				readings: formReadingsOfType(program, encodedParameterType(program, member.property)),
				read: true,
				required: member.property.optional !== true,
				property: member.property,
			});
		}
		const rest = object.rest;
		return {
			model,
			keys,
			rest:
				rest === "sealed"
					? none
					: typeof rest === "string"
						? { readings: EVERY_READING, read: false, required: false }
						: rest.kind === "type"
							? { readings: formReadingsOfType(program, rest.type), read: true, required: false }
							: rest.kind === "never"
								? none
								: { readings: EVERY_READING, read: true, required: false },
		};
	});
}

/**
 * **The readings of a key's text a value of `type` accepts** - see {@link FormReadings}. A string
 * accepts any text as itself; a string literal its own text; a number or a boolean the value a text
 * spells; a list the one-element list of what its element accepts; a value of any type every
 * reading. A scalar that reads no number or boolean - a date, `bytes` - is text, as a string is.
 */
function formReadingsOfType(program: Program, type: Type): FormReadings {
	let numeric = 0;
	let boolean = 0;
	let other = 0;
	const seen = new Set<Type>();
	// A literal's own text, in the class of text it is.
	const literalText = (value: string, itself: number): void => {
		if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) numeric |= itself;
		else if (value === "true" || value === "false") boolean |= itself;
		else other |= itself;
	};
	const visit = (each: Type, list: boolean): void => {
		if (seen.has(each)) return;
		seen.add(each);
		const [spelled, itself] = list ? [SPELLED_LIST, ITSELF_LIST] : [SPELLED, ITSELF];
		if (each.kind === "UnionVariant") return visit(each.type, list);
		if (each.kind === "Union") {
			for (const variant of each.variants.values()) visit(variant.type, list);
			return;
		}
		const element = elementOf(each);
		if (element !== undefined) {
			// A list of lists is no text a key spells.
			if (!list) visit(element, true);
			return;
		}
		if (isTypelessMember(program, each)) {
			numeric |= spelled | itself;
			boolean |= spelled | itself;
			other |= itself;
			return;
		}
		switch (each.kind) {
			case "String":
				return literalText(each.value, itself);
			case "Number":
				numeric |= spelled;
				return;
			case "Boolean":
				boolean |= spelled;
				return;
			case "Enum":
				for (const member of each.members.values()) visit(member, list);
				return;
			case "EnumMember":
				if (typeof each.value === "number") numeric |= spelled;
				else literalText(each.value ?? each.name, itself);
				return;
			case "Scalar":
				if (readsFromText(program, each)) {
					if (isBooleanScalar(each)) boolean |= spelled;
					else numeric |= spelled;
				} else {
					numeric |= itself;
					boolean |= itself;
					other |= itself;
				}
				return;
			default:
				return;
		}
	};
	visit(type, false);
	return { numeric, boolean, other };
}

/** Whether a scalar is `boolean`, or declared on it. */
function isBooleanScalar(scalar: Scalar): boolean {
	for (let each: Scalar | undefined = scalar; each !== undefined; each = each.baseScalar) {
		if (each.name === "boolean") return true;
	}
	return false;
}

/** Whether readers read anything, or leave every value the text it is. */
function readsText(readers: ValueReaders): boolean {
	return readers.values !== null || readers.fields !== null || readers.by !== undefined;
}

/**
 * **Every object a URL-encoded form can stand for in a body of this type, as the readers of its
 * text**: a model's own, and each model a union reaches, a union nested in it included. A member that
 * is no object - `string` or `int32` beside a model, a list, `null` - is never what a form is, so it
 * adds no reading, and its schema refuses the object as the document's does. A form is never `null`.
 */
function formReadingsOf(program: Program, registry: SchemaRegistry, type: Type): ValueReaders[] {
	if (type.kind === "Model") {
		return isArrayType(type)
			? []
			: [withParameterPosition(true, () => readersOf(program, registry, type, true))];
	}
	if (type.kind !== "Union") return [];
	const variants = [...type.variants.values()].map((variant) => variant.type);
	const [discriminated] = getDiscriminatedUnion(program, type);
	if (discriminated === undefined) {
		return variants.flatMap((variant) => formReadingsOf(program, registry, variant));
	}
	/**
	 * **A discriminated union is read as the variant its discriminator names**, as a discriminated
	 * base is - see `readersOf` - so a key two variants declare differently is read as the one sent.
	 * With no envelope the variant is the object. With one, the object is its envelope, `{ kind, value
	 * }`, and `value` is read as the variant: `kind=i&value=5` is `{ kind: "i", value: 5 }` where the
	 * variant is an `int32`, and `value=5` under `kind=l` the list `[5]`.
	 */
	const { envelope, discriminatorPropertyName, envelopePropertyName } = discriminated.options;
	const byVariant = [...discriminated.variants].map(([value, variant]): [string, ValueReaders] => {
		if (envelope === "none") {
			return [value, formReadingsOf(program, registry, variant)[0] ?? NO_READERS];
		}
		const reader = readerOf(program, registry, variant, undefined, true);
		return [
			value,
			reader === null ? NO_READERS : { values: null, fields: { [envelopePropertyName]: reader } },
		];
	});
	/**
	 * A variant that is a discriminated base dispatches on a discriminator of its own, which one
	 * dispatch does not reach: each variant is then a reading of its own, judged by the whole union.
	 */
	if (byVariant.some(([, readers]) => readers.by !== undefined)) {
		return variants.flatMap((variant) => formReadingsOf(program, registry, variant));
	}
	if (!byVariant.some(([, readers]) => readsText(readers))) return [NO_READERS];
	return [
		{
			values: null,
			fields: null,
			by: { property: discriminatorPropertyName, readers: Object.fromEntries(byVariant) },
		},
	];
}

function jsonOrTextDecoded(declared: string, asText: string): string {
	return `z.preprocess((raw) => { if (typeof raw !== "string") return raw; try { const parsed: unknown = JSON.parse(raw); if (${declared}.safeParse(parsed).success) return parsed; } catch { /* text, read as text */ } return raw; }, ${asText})`;
}

/**
 * **A JSON list part, decoded from one text as the whole list or from several as its elements** -
 * see {@link isJsonListPart}. A lone text is the list here, as the component publishes it; the
 * request boxes one that is not into the one element it is, before this applies.
 */
function jsonListDecoded(declared: string): string {
	return `z.preprocess((raw, ctx) => { try { if (typeof raw === "string") return JSON.parse(raw); if (Array.isArray(raw)) return raw.map((each: unknown) => (typeof each === "string" ? JSON.parse(each) : each)); } catch { ctx.addIssue({ code: "custom", message: "Invalid JSON in a multipart part" }); return z.NEVER; } return raw; }, ${declared})`;
}

function jsonTextDecoded(declared: string): string {
	return `z.preprocess((raw, ctx) => { if (typeof raw !== "string") return raw; try { return JSON.parse(raw); } catch { ctx.addIssue({ code: "custom", message: "Invalid JSON in a multipart part" }); return z.NEVER; } }, ${declared})`;
}

function isBinaryPart(program: Program, type: Type): boolean {
	if (type.kind === "Scalar") {
		for (let scalar: Scalar | undefined = type; scalar !== undefined; scalar = scalar.baseScalar) {
			if (scalar.name === "bytes") return true;
		}
		return false;
	}
	return type.kind === "Model" && isOrExtendsHttpFile(program, type);
}

/**
 * Whether a body served under these media types is RAW BINARY rather than a JSON value.
 *
 * **The distinction decides whether a validator may say anything about it at all.** A `bytes`
 * body inside a JSON payload is base64 and the document publishes `type: "string"` with
 * `contentEncoding`; a `bytes` body served as `application/octet-stream` or `image/png` is the bytes
 * themselves, and `@typespec/openapi3` publishes a schema carrying only `contentMediaType` - which is
 * an ANNOTATION under JSON Schema 2020-12, not an assertion. The document therefore states nothing
 * about the value, and a validator that requires a string enforces a rule no caller reading the
 * contract can see.
 *
 * **The same decision was already made for multipart and not for bodies**, which is how the two
 * came to disagree: a binary PART is `z.unknown()` because openapi3 publishes `{}` for it, while a
 * binary BODY stayed `z.string()`. Found by grading response-body kinds, a surface that had been
 * counted and never compared - three positions in `encode/bytes`.
 */
export function isRawBinaryMediaType(contentTypes: readonly string[]): boolean {
	if (contentTypes.length === 0) return false;
	return contentTypes.every((type) => !isJsonMediaType(type));
}

/**
 * A media type a server can parse a request body from into a value its schema can check: JSON and
 * the `+json` suffix RFC 6839 defines, a URL-encoded form, and multipart. Anything else - XML, a
 * vendor type - has no reading this emitter can derive from the document.
 */
function isParseableMediaType(type: string): boolean {
	const essence = mediaTypeEssenceOf(type);
	return (
		isJsonMediaType(essence) ||
		essence === "application/x-www-form-urlencoded" ||
		essence.startsWith("multipart/")
	);
}

/**
 * Whether a body is rendered with its metadata annotations ignored, as openapi3 renders it: an
 * explicit `@body` whose type carries them - see `withMetadataAnnotationsIgnored`.
 */
function ignoresMetadata(body: object | undefined): boolean {
	return (
		body !== undefined &&
		"isExplicit" in body &&
		body.isExplicit === true &&
		"containsMetadataAnnotations" in body &&
		body.containsMetadataAnnotations === true
	);
}

/** The declared request body type, if the operation takes one. */
function requestBodyOf(operation: HttpOperation): Type | undefined {
	const body = requestBodyParameterOf(operation);
	if (body?.bodyKind === "single") return body.type;
	return undefined;
}

export interface EmittedRoute {
	readonly operationId: string;
	readonly verb: string;
	readonly path: string;
	/**
	 * The WIRE names of path parameters that use RFC 6570 reserved expansion, and so match across `/`.
	 *
	 * **`path` alone cannot carry this, and that is not an oversight in the spelling.** A file path is
	 * `docs/guide.md`, so a files route has to be `GET /files/:path{.+}`; `@typespec/http` resolves
	 * `@route("/files/{+path}")` to `path` = `/files/{path}` with the operator already stripped, and
	 * `@typespec/openapi3` publishes the same. **Measured at 3.0.0, 3.1.0 and 3.2.0**: OpenAPI cannot
	 * express reserved expansion at any version, so the document says `/files/{path}` and openapi3
	 * raises `path-reserved-expansion` as a warning. The fact exists in the program and reaches no
	 * artefact, so a server emitter mounts a route that answers 404 to every request it was written
	 * for. This is the one place the IR deliberately carries more than the document - see
	 * `docs/reference.md`.
	 *
	 * **Read from the parameter, never by parsing `path` or `uriTemplate` for `{+`.** Two forms reach
	 * `allowReserved`, and only the parameter entry answers for both: the operator in the template
	 * (`@route("/files/{+path}")`), and `@path(#{allowReserved: true})` on a required parameter the
	 * template does not already name, which is what `@typespec/http-specs` itself uses and which
	 * `@typespec/http` resolves by APPENDING `{+param}` to the template. Deciding this by matching
	 * emitted text would also be the defect class that produced six others here.
	 *
	 * Wire names, so `@path("file-path") filePath` appears as `file-path` - the name a router has to
	 * match, and the same one `pathSchema` keys on. Empty when the operation has none, never
	 * `undefined`, so a consumer does not branch. Reserved-ness is per PARAMETER: `/repo/{owner}/{+ref}`
	 * carries one of each.
	 */
	readonly reservedPathParameters: readonly string[];
	/**
	 * **The route as a server has to mount it: one entry per `/` segment, read from the operation's
	 * RFC 6570 `uriTemplate`.** `path` cannot say this, because `@typespec/http` strips every operator
	 * from it: `array{.param*}` (`array.a.b`), `array{;param}` (`array;param=a,b`) and
	 * `array{/param}` (`array/a,b`) all reach `path` as `array{param}`. A router mounted from `path`
	 * answered 404 to 31 of the requests `@typespec/http-specs` declares conformant.
	 *
	 * An expression segment names its parameter's wire name, the literal text around it in the same
	 * segment, its operator and explode modifier, and whether it is optional or reserved. A server
	 * hands `pathSchema` the TEXT of that segment (for an exploding `/` expression, of every segment
	 * after it), and `pathSchema` undoes the expansion. A segment holding more than one expression is
	 * `unsupported`: no segment router can split it.
	 *
	 * **For a `/` expression this is the only statement of the route there is.** openapi3 cannot
	 * publish the operator: `/lx{/v*}` is `/lx{v}` in the document, under `simple` style and its own
	 * `invalid-style` warning, which joins an exploded list `1,2` where the route joins it `1/2`. The
	 * validator undoes the route's, as `@typespec/http-specs` expects - see `docs/reference.md`.
	 */
	readonly pathSegments: readonly EmittedPathSegment[];
	/**
	 * **The path parameters whose validator undoes an RFC 6570 expansion**, by wire name.
	 *
	 * For these, the path validator's field is `z.preprocess(<decode>, <value schema>)`: it takes the
	 * TEXT of the segment a router extracts - `primitive.a` for `{.param}` - and hands on the value,
	 * `a`. A caller already holding the value, such as a tool call or a service-binding request, must
	 * validate it against the value schema, `pathSchema.shape[name].out`: through the decoder, the value
	 * `a` is refused as not the expansion the route declares, and a value that happens to start with
	 * the route's literal is rewritten without an error. Decided by the same rule the validator is
	 * built by: a prefix or suffix in the segment, the `.` or `;` operator, or a parameter that is not
	 * a scalar. Empty when there is none, never `undefined`.
	 */
	readonly decodedPathParameters: readonly string[];
	/**
	 * Every pair of inputs a handler would be handed under ONE key - `@header("x")` beside
	 * `@query("x")`, two `@query("x")`, a `@path id` beside a `@header("id")`, a parameter named as
	 * the body is. Empty for almost every operation.
	 *
	 * **A server emitter spreads the parameter groups into one input, so the later group's value
	 * silently replaced the earlier one**, after each had been validated against its own schema.
	 * `@typespec/http` refuses only a path and a query parameter of one name. The handler input has
	 * one value per key and cannot carry both, so a server should not mount such an operation; this
	 * package reports it as `shared-input-key`, and states the key as both declarations at once. See
	 * {@link SharedInputKey}.
	 */
	readonly sharedInputKeys: readonly SharedInputKey[];
	/**
	 * A query string written into the route itself, as the pairs it spells:
	 * `/items?fixed=true{&param}` carries `[["fixed", "true"]]`. It identifies the route as much as
	 * the path does, and it is never part of `pathSegments`. Empty when there is none.
	 */
	readonly literalQuery: readonly (readonly [string, string])[];
	/**
	 * Every response the document declares, one per status key, in OpenAPI's precedence order. See
	 * {@link EmittedResponse}.
	 */
	readonly responses: readonly EmittedResponse[];
	/**
	 * Media types the lowest exact success status can be served as - the basis for `Accept`
	 * negotiation between several operations sharing one route. Empty where that status carries no
	 * body, or where the operation declares no exact success status at all.
	 */
	readonly responseContentTypes: readonly string[];
	/**
	 * Media types the request body may be SENT as.
	 *
	 * **This was missing entirely, and its absence was two live defects in the generated server.**
	 * The response side has carried `responseContentTypes` from the beginning; the request side carried
	 * nothing, so a server built on this library had no way to ask what the incoming body actually is.
	 * Both consequences were measured against a Petstore server under `wrangler dev`:
	 *
	 * - every request body was validated as JSON, so a `multipart/form-data` upload was handed to
	 *   `c.req.json()` - 17 such registrations in `payload/multipart` alone, and 11 of the 17 request
	 *   bodies in the Swagger Petstore are not JSON;
	 * - a `bytes` body was read with `c.req.text()` whatever it was sent as, which UTF-8-decodes. An
	 *   18-byte binary upload arrived at the handler as 23 code points with five bytes replaced by
	 *   U+FFFD - silently corrupted, answering **200**.
	 *
	 * A server emitter needs the document's own answer to "what is on the wire", and this is it.
	 * What to DO about it - which validator target, which body reader - belongs to the emitter that
	 * writes the server, exactly as `responseContentTypes` leaves negotiation to it.
	 */
	readonly requestContentTypes: readonly string[];
	/**
	 * Whether the request body IS the text a caller sends, rather than a structure parsed out of it.
	 *
	 * **A server cannot answer this from the media type alone**, and `typespec-hono` had no way to ask:
	 * `@body body: string` under `text/plain` has no JSON, form or multipart reader, so the body was
	 * never read and the handler was handed nothing. The same media type carrying a MODEL has no
	 * serialisation this emitter can derive, and must still be refused - so the question is about the
	 * TYPE, which only this package resolves.
	 *
	 * True where the body's type is a string (a scalar based on `string`, a literal, a template, or a
	 * union of those - the same rule {@link EmittedResponse.textual} applies to a response) and the
	 * document declares no JSON media type for it.
	 */
	readonly requestTextual: boolean;
	readonly summary: string | undefined;
	readonly requestSchema: string | undefined;
	/**
	 * **The body as a URL-encoded form carries it**, where the route also takes it under another media
	 * type: each field read from the text a form holds - `n=5` is `5` where `n` is an `int32` - and a
	 * key sent more than once read as the list it stands for. A server validates a form body with this
	 * and any other with {@link requestSchema}. `undefined` where no form is declared, or where only a
	 * form is, when `requestSchema` reads it itself: validated as JSON, every numeric or boolean field
	 * of a form refused every conformant request.
	 */
	readonly formRequestSchema?: string;
	/**
	 * **The multipart parts whose value is read from text**, each with whether it is JSON alone: every
	 * part but a file and raw bytes. A client may send one with a filename all the same - `curl -F
	 * 'r=@data.json;type=application/json'` - and a form reader then hands it over as a file, which
	 * the part's schema, reading text, refuses. A server reads such a part's text first. Its media type
	 * says what the part is, not the filename. `undefined` where the body is not multipart.
	 */
	readonly textParts?: readonly { readonly name: string; readonly json: boolean }[];
	/**
	 * The parameters, split by WHERE they arrive - see `parameterSchemasOf`.
	 *
	 * **A MERGED `paramsSchema` sat beside these and was deleted before 0.1.0 froze the surface.**
	 * It was written on every route and read by nothing here - not `nameRouteSchemas`, which declares
	 * from the split forms. Worse, it was computed by a second function under different rules, and both
	 * wire fixes the split forms received had been applied only there: it never decoded a path or query
	 * value, so `z.number().int()` met `"1"` and refused it, and it keyed headers on the TypeSpec
	 * property name rather than the wire name, which 400s every conformant request. It read as "the
	 * parameters", which made it the field a caller would reach for first.
	 */
	readonly pathSchema: string | undefined;
	/** Cookie parameters, as one object schema, or `undefined` where the operation declares none. */
	readonly cookieSchema: string | undefined;
	readonly querySchema: string | undefined;
	/**
	 * The query OBJECT itself, which differs from `querySchema` only where a form-exploded record or
	 * model is gathered into it: `querySchema` is then `z.preprocess(gather, <this>)`, the validator a
	 * request's raw query goes through, and this is the object with a `.shape` a consumer building
	 * arguments from already-structured JSON can spread. Equal to `querySchema` otherwise.
	 */
	readonly queryFieldsSchema: string | undefined;
	readonly headerSchema: string | undefined;
	/** The header schema minus `accept`, used when this route's operations negotiate. */
	readonly negotiatedHeaderSchema: string | undefined;
	/** The `accept` literal this operation answers to, when it declares one. */
	readonly accept: { readonly name: string; readonly value: string } | undefined;
	/**
	 * The input property that receives the UNPARSED body, when the operation declares one.
	 *
	 * Three bodies are handed over unparsed. A `bytes` body, because the bytes themselves are the
	 * contract: where a signature covers exactly what arrived, parsing and re-serialising would verify
	 * a different string than the sender signed. An `Http.File` body, whose contents are the body. And
	 * a body declared only under media types nothing can parse into it, such as a model as
	 * `application/xml`, which is the text that arrived, or as `application/octet-stream`, which is
	 * the bytes. {@link rawBodyBinary} says which are bytes.
	 */
	readonly rawBodyProperty: string | undefined;
	/**
	 * Whether the raw body is BYTES - handed over as the unread stream - rather than the text a
	 * signature covers. A `bytes` body is bytes under a binary media type and text under a JSON one;
	 * an `Http.File` body is bytes whatever its media type, which is why a server cannot read this off
	 * {@link requestContentTypes}: a file declared `application/json` looks like a JSON body there.
	 * `false` where there is no raw body.
	 */
	readonly rawBodyBinary: boolean;
	/**
	 * **The raw body is declared with a schema nothing checks it against**: it is declared only under
	 * media types nothing can parse into it, such as a model as `application/xml`. A `bytes` or
	 * `Http.File` body declares nothing to check, so it is not this. The request-side twin of
	 * {@link ResultMember.unvalidated}.
	 */
	readonly rawBodyUnvalidated: boolean;
	/**
	 * The input property a PARSED body arrives under, where it must not be spread into the parameters.
	 *
	 * **A body with an indexer cannot be flattened.** `@body body: Record<string>` merged with the
	 * query and header parameters gives an intersection whose index signature every sibling must
	 * satisfy, so an optional `@query q?: string` fails with
	 * `TS2345: 'q' is incompatible with index signature` and the generated server does not compile.
	 *
	 * **And flattening it was wrong before it failed to compile.** The document states the parameters
	 * and the body as separate things; merged, a body key named `q` silently overwrites the query
	 * parameter of that name. Naming the property keeps them apart, which is what the document says.
	 *
	 * `undefined` for an ordinary model body, which is spread as before. Same shape as
	 * {@link rawBodyProperty}, whose case is the same statement about a different body.
	 */
	readonly bodyProperty: string | undefined;
	/**
	 * Whether the document publishes `requestBody.required: false`, so a request carrying NO body at
	 * all is one the contract permits.
	 *
	 * **A body that may be absent cannot be flattened into the input, which is why this is published
	 * rather than kept internal.** Merged, there is no way to say "these properties are here only
	 * sometimes" without making every one of them optional, which would be a different and weaker
	 * claim about the body that IS sent. So an optional body is named, exactly as an indexed one is,
	 * and a wrapping emitter spells the property optional from this.
	 *
	 * Measured before it existed: a bodyless `POST` naming `content-type: application/json` answered
	 * **400 `Malformed JSON in request body`** as `text/plain`, produced before the app's `invalid`
	 * hook and so outside its error envelope entirely - a service refusing a request its own contract
	 * permits, in a shape that contract forbids.
	 */
	readonly optionalBody: boolean;
	/**
	 * **Whether the operation needs a caller, in the three states its `security` can say.**
	 *
	 * - `none`: no requirement asks for anything (`@useAuth(NoAuth)`, or no authentication at all).
	 * - `optional`: an anonymous alternative sits beside a real one (`NoAuth | BearerAuth`). A caller
	 *   who presents a credential is authenticated; one who presents none is still admitted.
	 * - `required`: every alternative asks for something.
	 *
	 * **This replaced `noAuth`, which could not tell the first two apart**, so a server passing it
	 * through treated `NoAuth | BearerAuth` as "no caller", and a caller with a valid token was never
	 * seen as one.
	 */
	readonly authentication: "none" | "optional" | "required";
	/**
	 * The OAuth scopes the operation requires, from `@useAuth`.
	 *
	 * **Per operation, never per surface.** A resource-wide list means either one scope for
	 * everything (a read-only grant could write) or the union of them (a read-only grant could not
	 * read), and neither is a grant a human would recognise from the consent screen. Emitted into the
	 * row so a server applies the gate the DOCUMENT publishes, rather than a hand-written
	 * `requireScopes(...)` repeated per route that nothing checks against it.
	 */
	readonly scopes: readonly string[];
	/**
	 * What the DOCUMENT says a caller must satisfy, in the shape the document says it.
	 *
	 * **`scopes` is a lossy projection of this (and a boolean `noAuth` was another), and publishing only those was a defect
	 * both server emitters had to work around.** A flat scope union cannot say WHICH scheme demanded
	 * what, so `@useAuth(BearerAuth)` -- which reaches OpenAPI as `security: [{ "BearerAuth": [] }]`
	 * -- arrived here as an empty scope list indistinguishable from no authentication at all. An
	 * emitter wanting the gate the document publishes had to call `getAuthenticationForOperation`
	 * again and rebuild this itself, and two of them did.
	 *
	 * Satisfying **any one** requirement authorises; every scheme within a requirement must be
	 * satisfied together. An anonymous alternative is the empty requirement `{}`, exactly as the
	 * document publishes it: `NoAuth | BearerAuth` is `[{}, { "BearerAuth": [] }]` and
	 * `@useAuth(NoAuth)` is `[{}]`. Empty where the operation declares no authentication at all.
	 * Whether a caller is needed is {@link EmittedRoute.authentication}.
	 */
	readonly security: readonly SecurityRequirement[];
}

/**
 * Parameters are emitted as their **own** schemas rather than folded into the body, because the two
 * are separate things in HTTP and in OpenAPI - but they are equally part of the operation's input,
 * and `?state=nonsense` must be a 400 rather than something the application has to defend against.
 * Leaving them undescribed would document a constraint the runtime does not enforce, which is the
 * same failure the vocabulary tuples exist to prevent one level down.
 *
 * **Split by WHERE they arrive, and only so.** A validator library validates one target at a time
 * - `("param", ...)`, `("query", ...)` - which is how a caller learns *which* part of the request was
 * wrong instead of being handed a merged object's complaint. A merged form existed beside these until
 * 0.1.0 and was deleted: nothing read it, and it had drifted into a second set of rules. See
 * `EmittedRoute.pathSchema`.
 */
/**
 * How a list is flattened into one query or header value, per OpenAPI's `style`.
 *
 * **Three of the four standard collection formats rejected every conformant request**, and only
 * one of the three was visible to the differential. `?colors=blue,red,green` arrives as a single
 * string; a validator expecting an array refuses it. For `pipes` and `ssv` the emitter also typed
 * the parameter as a string, so document and validator disagreed and the oracle said so - but for
 * `csv` both sides said `array` and **agreed perfectly** while the server 400'd every caller. No
 * document-to-validator comparison can see that: the disagreement is with the WIRE.
 *
 * `explode: true` is the exception - the value repeats (`?colors=blue&colors=red`) and Hono hands
 * back an array already, so there is nothing to undo.
 */
const COLLECTION_DELIMITERS: Readonly<Record<string, string>> = {
	"ArrayEncoding.pipeDelimited": "|",
	"ArrayEncoding.spaceDelimited": " ",
	"ArrayEncoding.commaDelimited": ",",
	"ArrayEncoding.newlineDelimited": "\n",
};

/** A parameter's array encoding - the `style` openapi3 publishes for it - or `undefined`. */
function arrayEncodingOf(program: Program, property: ModelProperty): string | undefined {
	const encoding = getEncode(program, property)?.encoding;
	return encoding !== undefined && encoding in COLLECTION_DELIMITERS ? encoding : undefined;
}

/**
 * Whether the parameter crosses the wire as a list, which is what makes a delimiter meaningful.
 *
 * **The encoded type, not the declared one.** `@header @encode(ArrayEncoding.commaDelimited) tags:
 * string[]` is a string on the wire - the document publishes `type: string` - and its schema is
 * `z.string()`; reading the declared list split `"a,b"` into an array and handed that to the string
 * schema, so every request was refused. Only a query parameter keeps its list under an array
 * encoding, and only there is a split undone.
 */
function isCollectionParameter(wire: Type): boolean {
	return isArrayType(wire);
}

/**
 * **The forms a parameter's text can take: one per shape its type's members have.** A union of a
 * scalar and a list - `int32 | string[]` - is `5` or `a,b` on the wire, and each is undone its own
 * way: the scalar members read as text, each list split, each record or model expanded. Undone only
 * as the scalar it might be, `a,b` was refused. A type of one shape is one form, itself.
 */
function wireFormsOf(type: Type): readonly Type[] {
	if (type.kind !== "Union") return [type];
	const members: Type[] = [];
	const visit = (each: Type): void => {
		if (each.kind === "UnionVariant") return visit(each.type);
		if (each.kind === "Union") return [...each.variants.values()].forEach((v) => visit(v.type));
		if (!(each.kind === "Intrinsic" && each.name === "null")) members.push(each);
	};
	visit(type);
	const shaped = members.filter((member) => expansionShapeOf(member) !== "scalar");
	if (shaped.length === 0) return [type];
	const scalar = members.some((member) => expansionShapeOf(member) === "scalar");
	// The union itself stands for its scalar members: a scalar's form, read against the whole schema.
	return [...(scalar ? [type] : []), ...shaped];
}

/**
 * Whether the values arrive one per OCCURRENCE (RFC 6570 explode) rather than joined into one.
 *
 * The distinction matters because of what `zValidator` hands the schema: for a repeated key it
 * builds an array, but for a single occurrence it hands the bare string - and one `key=value` pair
 * is exactly what a one-member exploded array looks like on the wire. A bare `z.array()` therefore
 * refused a conformant request while accepting the same list sent twice, which no document
 * describes.
 */
function isExplodedCollection(
	program: Program,
	parameter: {
		type: string;
		param: ModelProperty;
		explode?: boolean;
	},
	wire: Type,
): boolean {
	/**
	 * **A query only.** A header is `simple` style, which joins a list with commas exploded or not -
	 * explode changes how a `simple` OBJECT is written, never a list - so an exploded header list
	 * boxed whole was `["1,2"]`, refused where the document reads `[1, 2]`.
	 */
	return (
		isCollectionParameter(wire) &&
		parameter.type === "query" &&
		parameter.explode === true &&
		arrayEncodingOf(program, parameter.param) === undefined
	);
}

/**
 * The delimiter a parameter's values were joined with, or `undefined` when they were not joined.
 *
 * Defaults matter as much as the encodings: a query parameter with no `@encode` and no explode is
 * `form` style, which OpenAPI joins with a comma, and a header list is `simple` style, also comma.
 * Those are the two that looked correct because the document and the validator agreed.
 */
function collectionDelimiterOf(
	program: Program,
	parameter: { type: string; param: ModelProperty; explode?: boolean },
	wire: Type,
): string | undefined {
	if (!isCollectionParameter(wire)) return undefined;
	// A cookie is `form` with `explode: false` in the document, which joins a list with commas.
	if (parameter.type !== "query" && parameter.type !== "header" && parameter.type !== "cookie") {
		return undefined;
	}
	/**
	 * **An array encoding is a `style`, and it wins over `explode`.** openapi3 writes the encoding's
	 * style - `pipeDelimited` - and writes `explode: true` only by leaving it out, which for every
	 * style but `form` means NOT exploded. So the document joins the list with the encoding's
	 * delimiter, `?xp=1|2`, explode or not; boxed as one occurrence, that was refused.
	 */
	const encoding = arrayEncodingOf(program, parameter.param);
	if (encoding !== undefined) return COLLECTION_DELIMITERS[encoding];
	if (parameter.type === "query" && parameter.explode === true) return undefined;
	return ",";
}

/**
 * Decode a path, query or header value from the only thing HTTP can carry: text.
 *
 * **A path or query parameter ALWAYS arrives as a string, and `type: integer` describes what it
 * means once decoded - not what is on the wire.** `zValidator("param", ...)` hands `c.req.param()`
 * straight to the schema, so `z.number().int()` met `"1"` and refused it. Measured against a server
 * generated from the Swagger Petstore and run under `wrangler dev`:
 *
 * ```
 * GET /pet/findByStatus?status=available -> 200   (string)
 * GET /user/alice                        -> 200   (string)
 * GET /pet/1                             -> 400   (integer)   <- every conformant caller
 * GET /store/order/1                     -> 400   (integer)
 * ```
 *
 * **Nothing saw it because nothing ever asked.** Every path and query parameter in
 * `test/reference/service.tsp` - the only fixture that makes real requests - is a `string`. Across
 * the corpus this emitter writes **29 numeric query and header parameters** and requests none of
 * them. The validators were right about the document the whole time; the disagreement was with what
 * arrives, which is the one thing no document comparison can see.
 *
 * **This DECODES, it does not coerce.** `z.coerce.number()` would have been one character of
 * effort and wrong: `Number("")` is `0`, so `?limit=` would satisfy a required integer and an empty
 * value the document forbids would sail through as zero. A value that is not a well-formed number is
 * passed along UNCHANGED, so it fails against the schema the document published and reports the error
 * the document justifies. Same rule as the collection split above - decode the wire form, then apply
 * the document's schema to the result, never instead of it.
 *
 * **Read against the schema, not by a kind decided from the type** - see `WIRE_READ_SOURCE`. A
 * kind could not say `int32 | boolean`, a numeric enum, or `int32 | "all"`, where `"5"` is `5` and
 * `"all"` is text; each of them refused a value the document accepts. Only a type with a value text
 * cannot be read at all - every string - is left without a reader, and its validator is unchanged.
 */
function wireDecoded(
	program: Program,
	registry: SchemaRegistry,
	declared: string,
	type: Type,
): string {
	if (readsFromText(program, type)) {
		return `z.preprocess((raw) => wireRead(raw, ${declared}), ${declared})`;
	}
	/**
	 * A list whose ELEMENTS are read from text - `?ids=1,2,3` after the collection split, or a
	 * repeated `?id=1&id=2` - each against the element's own schema, as a lone scalar is. A non-array
	 * value is left alone; the split that produces the array runs outside this and may not have
	 * happened.
	 */
	const element = elementOf(type);
	if (element !== undefined && readsFromText(program, element)) {
		const schema = atItem(program, type as Model, () => registry.expressionFor(element));
		return `z.preprocess((raw) => (Array.isArray(raw) ? raw.map((item) => wireRead(item, ${schema})) : raw), ${declared})`;
	}
	return declared;
}

/**
 * Decode a `content-type` header down to the media type the document names.
 *
 * **A media type is a type PLUS parameters, and the document states only the type.** `@header
 * contentType: "multipart/form-data"` becomes `z.literal("multipart/form-data")`, which refuses
 * `multipart/form-data; boundary=...` - and RFC 2046 section 5.1.1 makes that boundary MANDATORY, so the
 * validator rejected **every syntactically valid multipart request**. Measured under `wrangler dev`:
 *
 * ```
 * expected "multipart/form-data"
 * received "multipart/form-data; boundary=------------------------IQFk2KVVVwrsWuOSm212u0"
 * ```
 *
 * Across the corpus this emitter writes **78 `z.literal` header validators, every one of them on
 * `content-type`**, in 12 scenarios. Seventeen are `multipart/form-data` and fail 100% of the time;
 * the remaining 61 refuse any caller sending the entirely legal `; charset=utf-8`.
 *
 * **Enforcing "no parameters" is enforcing something the document does not say**, which is the
 * governing rule read in the direction that is easy to miss: the rule forbids inventing constraints
 * just as much as it forbids dropping them. Stripping the parameters before comparing is the same
 * move as decoding `"1"` to `1` - undo the transport form, then apply the document's schema to the
 * result.
 *
 * Lowercased because RFC 9110 section 8.3.1 makes media type comparison case-insensitive - but ONLY when the
 * declared literal is itself lowercase, so a document that published an oddly-cased type keeps
 * matching exactly rather than silently never matching. Every literal openapi3 publishes across the
 * corpus is lowercase; this costs one condition and removes the way that fact could stop being true.
 */
function mediaTypeDecoded(declared: string): string {
	/**
	 * **One accepted media type is a literal; several are an ENUM, and the second form is the one a
	 * real document produces.** The corpus writes 78 `content-type` validators and every one is a
	 * single literal, so a decoder that handled only `z.literal` looked complete against it. The
	 * Swagger Petstore's `addPet` accepts three media types and openapi3 publishes
	 * `z.enum(["application/json", "application/xml", "application/x-www-form-urlencoded"])` - which
	 * went on refusing `application/json; charset=utf-8` after the literal case was fixed. Measured:
	 * with the charset parameter **400**, without it **200**, same body.
	 */
	const values =
		/^z\.literal\("([^"]+)"\)/.exec(declared)?.slice(1, 2) ??
		/^z\.enum\(\[([^\]]+)\]\)/
			.exec(declared)?.[1]
			?.split(",")
			.map((entry) => entry.trim().replace(/^"|"$/g, ""));
	if (values === undefined || values.length === 0) return declared;
	/**
	 * **A declared media RANGE admits the types inside it, and a literal admits only itself.**
	 *
	 * \`@header contentType: "text/*"\` published \`z.literal("text/*")\`, so the only request that
	 * satisfied it was one sending the range itself as its \`Content-Type\`, which no client does.
	 * Measured before this existed: \`text/plain\` and \`text/html\` both answered 400 on a route whose
	 * document declares the whole \`text\` group.
	 *
	 * A template literal is the Zod counterpart of the TypeScript type the contract already uses for
	 * a range, so the validator and the handler's own type say the same thing.
	 */
	const admitted = values.map((value) => {
		/**
		 * **The full wildcard admits every media type, so there is nothing left to match on.**
		 *
		 * Spelled as a template literal it becomes the prefix `*` + `/`, which matches only a
		 * Content-Type whose text begins with the range's own first two characters. Measured on the
		 * emitted schema: `application/json`, `text/plain` and `image/png` were all REFUSED and the
		 * literal `*` + `/*` was the one value accepted, which is the defect the range branch exists
		 * to remove rather than to respell. A file upload that takes whatever the caller sends declares
		 * exactly this.
		 */
		if (value === "*/*") return "z.string()";
		return isMediaRange(value)
			? `z.templateLiteral([${literal(mediaTypeEssenceOf(value).slice(0, -1))}, z.string()])`
			: `z.literal(${literal(value)})`;
	});
	const schema =
		admitted.length === 1 ? (admitted[0] ?? declared) : `z.union([${admitted.join(", ")}])`;
	const ranged = values.some(isMediaRange) ? schema : declared;
	/**
	 * **The request's media type is reduced to its essence, and so is every declared one.** A value
	 * declared as its own essence - `application/json` - is the literal the essence is compared with.
	 * One declared with a parameter or in capitals - `application/json; charset=utf-8` - is restored
	 * from the essence, so the request is admitted and the handler is given the type as the document
	 * declares it, which is what its input type says. Compared as written, such a value refused every
	 * request: no request's essence carries a parameter.
	 */
	const restored = values.filter(
		(value) => !isMediaRange(value) && mediaTypeEssenceOf(value) !== value,
	);
	const essence = `(raw.split(";")[0] ?? "").trim().toLowerCase()`;
	const decoded =
		restored.length === 0
			? essence
			: `((essence) => ${restored
					.map(
						(value) => `essence === ${literal(mediaTypeEssenceOf(value))} ? ${literal(value)} : `,
					)
					.join("")}essence)(${essence})`;
	return `z.preprocess((raw) => (typeof raw === "string" ? ${decoded} : raw), ${ranged})`;
}

function parameterSchemasOf(
	program: Program,
	operation: HttpOperation,
	registry: SchemaRegistry,
	segments: readonly EmittedPathSegment[],
	/** The names of a query string written into the route itself, which no parameter may gather. */
	literalQueryNames: readonly string[],
): {
	/** Cookie parameters. No collection encoding: `CookieOptions` carries only a name. */
	cookie: string | undefined;
	path: string | undefined;
	query: string | undefined;
	/** The query OBJECT, before any exploded record or model is gathered into it. */
	queryFields: string | undefined;
	header: string | undefined;
	/** The header schema MINUS `accept`, for a route whose operations negotiate. */
	negotiatedHeader: string | undefined;
	/** The `accept` literal this operation answers to, when it declares one. */
	accept: { name: string; value: string } | undefined;
} {
	const byTarget: Record<string, string[]> = {};
	const add = (target: string, key: string, expression: string): void => {
		(byTarget[target] ??= []).push(`\t${objectKey(key)}: ${expression},`);
	};
	let accept: { name: string; value: string } | undefined;
	/** Form-exploded records and models, gathered back under their names around the query object. */
	const gathered: string[] = [];
	const parameters = publishedParametersOf(operation);
	const queryNames = parameters
		.filter((parameter) => parameter.type === "query")
		.map((parameter) => parameter.name);
	for (const parameter of parameters) {
		/**
		 * **`cookie` is here because `@typespec/http` puts it here**, and excluding it was silent.
		 * `HttpOperationParameter` discriminates on `"header" | "cookie" | "query" | "path"`, and this
		 * filter named three of the four, so a `@cookie` reached no validator, no handler input and no
		 * diagnostic while `@typespec/openapi3` published it as `in: cookie, required: true`. A
		 * requirement the document states and the server cannot see is the defect class this package
		 * exists to remove, and a cookie is where a session and a CSRF token normally live.
		 *
		 * The exclusion was by omission rather than by a `never` check, which is why TypeScript never
		 * objected; every other place that reads `parameter.type` handles an encoding question a cookie
		 * does not have, since `CookieOptions` carries only a name.
		 */
		if (
			parameter.type !== "path" &&
			parameter.type !== "query" &&
			parameter.type !== "header" &&
			parameter.type !== "cookie"
		) {
			continue;
		}
		/**
		 * **`parameter.name` is the WIRE name; `parameter.param.name` is the TypeSpec one.** Headers
		 * used to be keyed on the second, and it made every header validator reject every conformant
		 * request: `@header("x-request-id") requestId: string` produced `z.object({ requestId })`, while
		 * `zValidator` reads what actually arrived - a header called `x-request-id`. Measured: **400
		 * against the emitted schema, 200 against the documented one**.
		 *
		 * The wire name is also the right answer for path and query where the two differ
		 * (`@query("$select") select`), and it is what `propertyKey` already does for body properties
		 * via `resolveEncodedName` - the document publishes one name per parameter, and it is this one.
		 * The TypeSpec property name is an authoring convenience that does not survive to the contract.
		 */
		/**
		 * **Two parameters of one location and one wire name are one value on the wire, and the
		 * document publishes the first.** openapi3 writes one parameter per name and location, so
		 * `@query("x") a: string` beside `@query("x") b: int32` is published as `x: string`, and `?x=abc`
		 * is valid. Intersected, as both declarations, it was refused. `shared-input-key` reports it.
		 */
		const first = parameters.find((other) => sameWireName(other, parameter));
		if (first !== parameter) continue;
		// A header another one names in other case is refused, as `never` - see `headerCaseCollisionOf`.
		if (headerCaseCollisionOf(program, operation, parameter)) {
			const refused = parameter.param.optional ? "z.never().exactOptional()" : "z.never()";
			add(parameter.type, parameter.name, refused);
			add("header-without-accept", parameter.name, refused);
			continue;
		}
		/**
		 * A parameter published as a reference to another document states no schema - openapi3 writes
		 * the reference and nothing else - and is refused, as a type published so is.
		 */
		const external = externalReferenceOf(parameter.param);
		if (external !== undefined) {
			const refused = refuseExternalReference(program, parameter.param, external);
			const value = parameter.param.optional ? `${refused}.exactOptional()` : refused;
			add(parameter.type, parameter.name, value);
			if (parameter.type === "header") add("header-without-accept", parameter.name, value);
			continue;
		}
		// At the visibility its shared component is published at - see `parameterVisibilityOf`.
		withVisibility(parameterVisibilityOf(parameter.param) ?? currentVisibility(), () => {
			const declared = registry.expressionForProperty(parameter.param);
			/**
			 * Each form the value can take, undone its own way and validated against the WHOLE schema - see
			 * `wireFormsOf`. The first form the schema accepts is the value, as the first reading `wireRead`
			 * finds is.
			 */
			/**
			 * `@encode` on the PROPERTY changes what crosses the wire, so the encoded type is the one to
			 * read - see below.
			 */
			const wires = wireFormsOf(encodedParameterType(program, parameter.param));
			// The members a form-exploded query gathers back under its name - see `formOf`.
			const objectForms =
				parameter.type === "query" && parameter.explode === true
					? wires.filter((wire) => expansionShapeOf(wire) === "record")
					: [];
			/**
			 * **A list or a scalar beside them is the parameter sent as itself**, `?x=1&x=2`, which the
			 * objects' gatherer would take as a key of its own - see `WIRE_ITSELF_SOURCE`. Then, as for a
			 * union of models, the query is gathered once and each member reads it its own way.
			 */
			const itself = objectForms.length > 0 && wires.length > objectForms.length;
			const gatheredOnce = objectForms.length > 1 || itself;
			const gatheredOthers = [
				...queryNames.filter((name) => name !== parameter.name),
				...literalQueryNames,
			];
			const formOf = (wire: Type): string => {
				const delimiter = collectionDelimiterOf(program, parameter, wire);
				/**
				 * The wire form is decoded before it is validated, never instead of it. `z.preprocess` undoes
				 * exactly the flattening the document's `style` describes and then applies the schema the
				 * document publishes, so every constraint on the list - `minItems`, the element type - still
				 * runs. Splitting in the handler instead would have left those unenforced.
				 */
				/**
				 * Decoded BEFORE the split is wrapped around it, so the two nest in wire order: the outer
				 * preprocess turns `"1,2,3"` into `["1","2","3"]`, the inner one turns those into numbers, and
				 * the document's schema then validates the result. Wrapping the other way round would hand the
				 * element decoder an unsplit string.
				 */
				const decoded =
					parameter.type === "header" && parameter.name.toLowerCase() === "content-type"
						? mediaTypeDecoded(declared)
						: wireDecoded(program, registry, declared, wire);
				/**
				 * The boxing half of the same principle: an exploded array's single occurrence arrives as a
				 * bare string, so it is boxed into the one-element array the document describes before the
				 * schema runs - every constraint on the list still applies to the result. Several
				 * occurrences arrive already an array and pass through untouched, exactly as the delimiter
				 * arm leaves a pre-split value alone.
				 */
				const boxedOrSplit = isExplodedCollection(program, parameter, wire)
					? `z.preprocess((raw) => (typeof raw === "string" ? [raw] : raw), ${decoded})`
					: delimiter === undefined
						? decoded
						: `z.preprocess((raw) => (typeof raw === "string" ? raw.split(${literal(delimiter)}) : raw), ${decoded})`;
				/**
				 * **An RFC 6570 expansion is undone OUTSIDE everything above**, because it is the first thing the
				 * wire did: `array.a.b` becomes `["a", "b"]`, then the element decoder and the document's schema
				 * run on that. See {@link uriExpansionCall}.
				 */
				const shape = expansionShapeOf(wire);
				// A key repeats only in a form-exploded query - see `readersOf`.
				const readers = readersOf(program, registry, wire, false);
				let expression = boxedOrSplit;
				if (parameter.type === "path") {
					const segment = decodedSegmentOf(program, parameter, segments, wire);
					if (segment !== undefined) {
						// A value of any type is the shape its expansion spells - see `URI_EXPANSION_SOURCE`.
						const any = shape === "scalar" && takesAnyValue(program, wire);
						expression = `z.preprocess(${uriExpansionCall({
							...segment,
							name: parameter.name,
							shape: any ? "any" : shape,
							readers: any ? { values: "z.unknown()", fields: null } : readers,
						})}, ${decoded})`;
					}
				} else if (
					(parameter.type === "header" || parameter.type === "cookie") &&
					shape === "record"
				) {
					/**
					 * **A header or a cookie carries a record or a model as text too**, and nothing read it: the
					 * validator met `"a,1,b,2"` where the document's schema describes `{a: 1, b: 2}`, and refused
					 * every value. A header is `simple` style - `a,1,b,2`, or `a=1,b=2` exploded - and a cookie is
					 * `form` without explode, as openapi3 publishes it: the same expansion as a query's, undone
					 * the same way.
					 */
					const explode = parameter.type === "header" && parameter.explode === true;
					expression = `z.preprocess(${uriExpansionCall({ prefix: "", suffix: "", operator: "", name: parameter.name, explode, shape, readers })}, ${decoded})`;
				} else if (parameter.type === "query" && shape === "record") {
					if (parameter.explode === true) {
						/**
						 * `{?param*}` over an object expands to the object's own keys, so there is no `param` key for
						 * this entry to read; the gatherer around the query object puts one back. A union of
						 * models is gathered once, below, and each member reads the gathered values its own way.
						 */
						const repeated = readersOf(program, registry, wire, true);
						if (gatheredOnce) {
							expression = `z.preprocess(${wireReadObjectCall(repeated)}, ${expression})`;
						} else {
							const model = wire.kind === "Model" && wire.indexer === undefined ? wire : undefined;
							gathered.push(
								explodedQueryCall({
									name: parameter.name,
									others: gatheredOthers,
									keys: model === undefined ? undefined : explodedKeysOf(program, model),
									itself: false,
									readers: repeated,
								}),
							);
						}
					} else {
						expression = `z.preprocess(${uriExpansionCall({ prefix: "", suffix: "", operator: "", name: parameter.name, explode: false, shape, readers })}, ${decoded})`;
					}
				} else if (itself) {
					// What arrived under the name, where the objects' gatherer took the query.
					expression = `z.preprocess(${wireItselfCall()}, ${expression})`;
				}
				return expression;
			};
			/**
			 * `@encode` on the PROPERTY changes what crosses the wire, so the encoded type is the one to
			 * read. `@encode("unixTimestamp", int32) value: utcDateTime` is a number on the wire and a date
			 * in the spec, and reading the declared type alone stopped eighteen such parameters being
			 * decoded.
			 */
			const forms = wires.map(formOf);
			if (gatheredOnce) {
				// One gatherer for every member, over every key one of them declares - see `formOf`.
				const keyed = objectForms.map((wire) =>
					wire.kind === "Model" && wire.indexer === undefined
						? explodedKeysOf(program, wire)
						: undefined,
				);
				gathered.push(
					explodedQueryCall({
						name: parameter.name,
						others: gatheredOthers,
						keys: keyed.includes(undefined)
							? undefined
							: [...new Set(keyed.flatMap((keys) => keys ?? []))],
						itself,
						readers: NO_READERS,
					}),
				);
			}
			const expression =
				forms.length === 1 ? (forms[0] as string) : `z.union([${forms.join(", ")}])`;
			add(parameter.type, parameter.name, expression);
			/**
			 * **On a route several operations share, `accept` SELECTS the operation - it is not a
			 * constraint on one of them.** Each member declares its own literal, so validating against any
			 * single member's would 400 every request asking for one of the others, and 400 is the wrong
			 * answer twice over: the request is well-formed, and the contract's answer to "I cannot serve
			 * what you asked for" is 406. `selectContentType` decides it instead, so the negotiated route
			 * validates every OTHER header and leaves this one to the negotiation.
			 */
			if (parameter.type === "header" && parameter.name.toLowerCase() === "accept") {
				const declared = parameter.param.type;
				if (declared.kind === "String") accept = { name: parameter.name, value: declared.value };
			} else if (parameter.type === "header") {
				add("header-without-accept", parameter.name, expression);
			}
		});
	}
	const fileContentType = fileContentTypeOf(operation);
	if (fileContentType !== undefined) {
		// The same decoding a declared `Content-Type` header gets: parameters dropped, lowercased.
		const expression = mediaTypeDecoded(registry.expressionFor(fileContentType.type));
		add("header", "Content-Type", expression);
		add("header-without-accept", "Content-Type", expression);
	}
	const shape = (target: string): string | undefined => {
		const entries = byTarget[target];
		return entries === undefined ? undefined : `z.object({\n${entries.join("\n")}\n})`;
	};
	const query = shape("query");
	return {
		cookie: shape("cookie"),
		path: shape("path"),
		query:
			query === undefined
				? undefined
				: gathered.reduce((inner, gather) => `z.preprocess(${gather}, ${inner})`, query),
		queryFields: query,
		header: shape("header"),
		negotiatedHeader: shape("header-without-accept"),
		accept,
	};
}

/**
 * The route segment a path parameter's validator decodes, or `undefined` where it validates the
 * segment's text as the value. The one rule for both the validator and
 * {@link EmittedRoute.decodedPathParameters}, so a consumer reading the route cannot disagree with
 * the validator it describes.
 *
 * **Shaped from the encoded type, as the validator's schema is.** `@path
 * @encode(ArrayEncoding.commaDelimited) ids: string[]` is a string on the wire, published as `type:
 * string`, and validated by `z.string()`; shaped from the declared list it was expanded into
 * `["a", "b"]` first, and every request was refused.
 */
function decodedSegmentOf(
	program: Program,
	parameter: HttpOperationParameter,
	segments: readonly EmittedPathSegment[],
	wire?: Type,
): Extract<EmittedPathSegment, { kind: "expression" }> | undefined {
	const segment = segments.find(
		(candidate): candidate is Extract<EmittedPathSegment, { kind: "expression" }> =>
			candidate.kind === "expression" && candidate.parameter === parameter.name,
	);
	if (segment === undefined) return undefined;
	// Decoded where any form the value can take is - see `wireFormsOf`.
	const forms =
		wire === undefined ? wireFormsOf(encodedParameterType(program, parameter.param)) : [wire];
	return forms.some((form) => needsExpansionDecoding(segment, expansionShapeOf(form)))
		? segment
		: undefined;
}

/**
 * **Whether a value of the type may be anything**: `unknown`, a scalar with no standard base, or a
 * union holding one - published as `{}` or with `{}` among its members - so its text may spell a list
 * or an object as well as a scalar.
 */
function takesAnyValue(program: Program, type: Type): boolean {
	if (type.kind === "UnionVariant") return takesAnyValue(program, type.type);
	if (type.kind === "Union") {
		return [...type.variants.values()].some((variant) => takesAnyValue(program, variant.type));
	}
	return isTypelessMember(program, type);
}

/** What a parameter's value decodes into once its expansion is undone. */
function expansionShapeOf(type: Type): ExpansionShape {
	if (isArrayType(type)) return "list";
	return type.kind === "Model" ? "record" : "scalar";
}

/**
 * The schemas a record's or a model's values are read from text against - see `wireRead`: every
 * value of a record against its indexer's, each key of a model against its property's. A value
 * text cannot spell anything else, a string, needs none.
 *
 * `repeats` says whether a key may arrive more than once, a list as its repeated values: a
 * form-exploded query object, and a URL-encoded form. There a lone occurrence is boxed into the list
 * it stands for. Anywhere else a value is one piece of text, which spells no list: boxed in a header,
 * a cookie, a path or a non-exploded query, `l,1` was `{ l: [1] }` where the document reads
 * `{ l: "1" }` and refuses it, and `l,1,l,2` dropped the first value.
 */
function readersOf(
	program: Program,
	registry: SchemaRegistry,
	type: Type,
	repeats: boolean,
): ValueReaders {
	if (type.kind !== "Model" || isArrayType(type)) return NO_READERS;
	/**
	 * **Every key no member names is read as the indexer that holds it, the topmost in the chain** -
	 * see `bindingIndexerOf`. Read as the model's own, an inherited `...Record<int32>` read nothing and
	 * a subtype's narrower indexer read what the base's, which the validator enforces, accepts.
	 */
	const binding = bindingIndexerOf(type);
	const values =
		binding === undefined || isNeverType(binding.value)
			? null
			: readerOf(program, registry, binding.value, undefined, repeats);
	/**
	 * **Each key is read as the validator holds it**: the object the model is rendered as, each member
	 * its most derived declaration at its position. Read first-wins from the base down, `Sub { x?:
	 * string }` under `Base { x?: int32 | string }` read `"5"` as `5`, and `Sub` refused it.
	 *
	 * **Where an indexer reads every key, a declared key is read as its own property says** - text
	 * included, so `s?: string` beside `...Record<int32 | string>` stays `"5"` rather than taking the
	 * indexer's reading and becoming `5`.
	 */
	const fields: Record<string, string> = {};
	withVisibility(renderedVisibilityOf(program, type, currentVisibility()), () => {
		const object = objectOfModel(program, type);
		if (object.kind !== "object") return;
		for (const member of object.members) {
			if (member.property === undefined) continue;
			const reader = readerOf(
				program,
				registry,
				encodedParameterType(program, member.property),
				{ property: member.property, position: member.position },
				repeats,
				values !== null,
			);
			if (reader !== null) fields[member.key] = reader;
		}
	});
	/**
	 * **A discriminated base is read as the subtype its discriminator names**: a header `Snake`
	 * carrying `kind,cobra,length,5` is a `Cobra`, whose `length` is a number, and `Pet` carrying
	 * `kind,cat,x,5` a `Cat`, whose `x` is a string though `Dog`'s is a number. Read by one table for
	 * every subtype, a key two of them declare was read as the first's.
	 */
	const discriminator = getDiscriminator(program, type);
	const dispatched = dispatchedSubtypesOf(program, type);
	return {
		values,
		fields: Object.keys(fields).length === 0 ? null : fields,
		...(discriminator === undefined || dispatched.length === 0
			? {}
			: {
					by: {
						property: discriminator.propertyName,
						readers: Object.fromEntries(
							dispatched.map(([value, subtype]) => [
								value,
								readersOf(program, registry, subtype, repeats),
							]),
						),
					},
				}),
	};
}

/**
 * The reader for one value of a record or a model, or `null` for none: a list boxed and read element
 * by element where a key repeats, a value text can spell as something else read against its schema -
 * the member's, at its position, where there is one - and text, which needs no reading unless
 * `always`.
 */
function readerOf(
	program: Program,
	registry: SchemaRegistry,
	type: Type,
	member: { readonly property: ModelProperty; readonly position: PropertyPosition } | undefined,
	repeats: boolean,
	always = false,
): string | null {
	const whole = (): string =>
		member === undefined
			? withParameterPosition(true, () => registry.expressionFor(type))
			: registry.expressionForProperty(member.property, member.position);
	// Text is never `null`, so a `| null` beside a list leaves the list to read.
	const inner = nullableInnerOf(type) ?? type;
	const element = elementOf(inner);
	if (element !== undefined) {
		// One piece of text spells no list, so it is left to the schema to refuse.
		if (!repeats) return always ? whole() : null;
		return eachReader(
			atItem(program, inner as Model, () =>
				withParameterPosition(true, () => registry.expressionFor(element)),
			),
		);
	}
	/**
	 * **A union holding a list is one value or several**: `e?: int32 | int32[]` arrives as `?e=1` or
	 * `?e=1&e=2`. Several are read as the list's elements; one is read against the whole type, which
	 * takes it as the one value. Read as text alone, the repeated key reached the schema unread and was
	 * refused where the document reads `[1, 2]`. Where a key does not repeat, it is only ever one.
	 */
	const forms = inner.kind === "Union" ? wireFormsOf(inner) : [];
	const lists = forms.filter((each) => elementOf(each) !== undefined);
	if (lists.length > 0) {
		if (!repeats) return whole();
		/**
		 * **Every list member's elements, and the whole value to choose by**: `int32[] | string[]`
		 * reads `?ll=1&ll=x` as the strings, the reading the whole accepts, where its first member's
		 * elements made it `[1, "x"]`, and refused. One value is the one value only where a member is
		 * not a list; `?ll=x` is the list `["x"]`.
		 */
		const each = lists.map((list) =>
			atItem(program, list as Model, () =>
				withParameterPosition(true, () => registry.expressionFor(elementOf(list) as Type)),
			),
		);
		const one = forms.some((each) => elementOf(each) === undefined) ? whole() : undefined;
		return eachReader(each, one, whole());
	}
	if (!always && !readsFromText(program, type)) return null;
	return whole();
}

/**
 * **The keys a form-exploded model is gathered by: the members its validator declares**, at the
 * visibility it is rendered at. Every property was a key, so `?secret=x` on a GET gathered a
 * create-only property the document does not publish there, and a sealed model refused the request
 * the document reads as `{}`.
 */
function explodedKeysOf(program: Program, model: Model): string[] {
	return withVisibility(renderedVisibilityOf(program, model, currentVisibility()), () => {
		const object = objectOfModel(program, model);
		return object.kind === "object" ? object.members.map((member) => member.key) : [];
	});
}

/**
 * **The media type an `Http.File` body declares, as the input it is.** A file's `contentType` is the
 * request's `Content-Type`: `Http.File<"image/png" | "image/jpeg">` accepts either and the handler has
 * to know which arrived, exactly as it would from a declared `@header contentType`. `@typespec/http`
 * keeps it on the file model rather than among the operation's parameters, so without this a
 * handler for a two-type upload had the bytes and no way to tell what they were.
 *
 * `undefined` where the body is not a file, or where the operation already declares the header.
 */
function fileContentTypeOf(operation: HttpOperation): ModelProperty | undefined {
	const body = requestBodyParameterOf(operation);
	if (body?.bodyKind !== "file") return undefined;
	const declared = publishedParametersOf(operation).some(
		(parameter) => parameter.type === "header" && parameter.name.toLowerCase() === "content-type",
	);
	return declared ? undefined : body.contentTypeProperty;
}

/**
 * Where a request body reaches a handler's input: spread into it, named under a property, or handed
 * over unread.
 *
 * **One decision, read by every artefact that states an operation's input.** The server emitters
 * render a handler's input from {@link EmittedRoute.bodyProperty}; the contract types in
 * `requests.gen.ts` re-derived the input for themselves and always merged, so for every body this
 * names - an indexer, an optional body, a scalar, enum or union - `WireInputs` described an input no
 * handler receives.
 */
/**
 * The keys a merged body would contribute to the handler's input: each key of the object the body's
 * validator declares, under its wire name, or each named part of a multipart body.
 *
 * **Read from that object, at the visibility and in the context it is rendered in**, so the two
 * cannot disagree. A read-only property is one openapi3 shares into a request that has nothing else
 * request-specific, as `readOnly` and still required under OAS 3.1's reading: read at the request
 * visibility it dropped out, so `@path shelfId` beside a body requiring `shelfId` was merged with it
 * and one of the two lost.
 */
function mergedBodyKeysOf(program: Program, operation: HttpOperation): string[] {
	const body = requestBodyParameterOf(operation);
	if (body?.bodyKind === "multipart") {
		return body.parts.flatMap((part) => (part.name === undefined ? [] : [part.name]));
	}
	const type = requestBodyOf(operation);
	if (type?.kind !== "Model") return [];
	const requested = requestVisibilityOf(program, operation);
	return withVisibility(rootVisibilityOf(program, type, requested), () =>
		withMetadataAnnotationsIgnored(ignoresMetadata(body), () => {
			const object = objectOfModel(program, type);
			return object.kind === "object" ? object.members.map((member) => member.key) : [];
		}),
	);
}

/**
 * **Whether two parameters name one value on the wire**: one location and one name - a header's name
 * read without its case, as HTTP reads it (RFC 9110 section 5.1).
 */
function sameWireName(
	one: { readonly type: string; readonly name: string },
	other: { readonly type: string; readonly name: string },
): boolean {
	return (
		one.type === other.type &&
		(one.type === "header"
			? one.name.toLowerCase() === other.name.toLowerCase()
			: one.name === other.name)
	);
}

/**
 * **Two headers whose names differ only in case are one header**, and openapi3 publishes them as two
 * parameters of the one value - `x-foo: int32` and `X-Foo: string` - which every value has to
 * satisfy at once and a server hands over once. `header-case-collision`, an error, reported once per
 * pair, and both validate nothing; validated as the last, `X-Foo: abc` was served where the
 * document refuses it.
 */
const headerCaseCollisionsReported = new WeakMap<Program, Set<string>>();
function headerCaseCollisionOf(
	program: Program,
	operation: HttpOperation,
	parameter: HttpOperation["parameters"]["parameters"][number],
): boolean {
	if (parameter.type !== "header") return false;
	const other = publishedParametersOf(operation).find(
		(each) =>
			each.type === "header" &&
			each.name !== parameter.name &&
			each.name.toLowerCase() === parameter.name.toLowerCase(),
	);
	if (other === undefined) return false;
	const names = [parameter.name, other.name].toSorted();
	const reported = headerCaseCollisionsReported.get(program) ?? new Set<string>();
	headerCaseCollisionsReported.set(program, reported);
	const key = `${operation.operation.name}\u0000${names.join("\u0000")}`;
	if (!reported.has(key)) {
		reported.add(key);
		reportDiagnostic(program, {
			code: "header-case-collision",
			target: parameter.param,
			format: {
				operation: operation.operation.name,
				first: names[0] ?? "",
				second: names[1] ?? "",
			},
		});
	}
	return true;
}

/** Where a value reaches a handler's input from. */
export type InputLocation = "path" | "query" | "header" | "cookie" | "body";

/** Two inputs a handler would be handed under one key. See {@link EmittedRoute.sharedInputKeys}. */
export interface SharedInputKey {
	/** The key both arrive under, as the input spells it. */
	readonly key: string;
	/** Where the input declared first comes from. */
	readonly first: InputLocation;
	/** Where the input declared second comes from. */
	readonly second: InputLocation;
}

const INPUT_LOCATION_NOUNS: Readonly<Record<InputLocation, string>> = {
	path: "path parameter",
	query: "query parameter",
	header: "header",
	cookie: "cookie",
	body: "body",
};

/**
 * The pairs of inputs an operation hands its handler under one key, reported once per pair and
 * program.
 *
 * **Read from the same facts the input is rendered from**: each parameter under its wire name, the
 * `Content-Type` of an `Http.File` body, and the body where {@link requestBodyPlacementOf} names it.
 * A merged body is not listed, because that decision already names the body whenever one of its keys
 * is a parameter's - which is how a `@query("body")` beside a body named `body` stays possible to
 * write, and why it is caught here rather than there.
 *
 * Resolved once per operation, since the route walk and the contract walk both read it and the
 * warning must be raised once.
 */
function sharedInputKeysOf(program: Program, operation: HttpOperation): readonly SharedInputKey[] {
	const resolved = sharedInputKeys.get(operation);
	if (resolved !== undefined) return resolved;
	const inputs: { key: string; location: InputLocation; target: Type }[] = [];
	for (const parameter of publishedParametersOf(operation)) {
		if (
			parameter.type === "path" ||
			parameter.type === "query" ||
			parameter.type === "header" ||
			parameter.type === "cookie"
		) {
			inputs.push({ key: parameter.name, location: parameter.type, target: parameter.param });
		}
	}
	const fileContentType = fileContentTypeOf(operation);
	if (fileContentType !== undefined) {
		inputs.push({ key: "Content-Type", location: "header", target: fileContentType });
	}
	const placement = requestBodyPlacementOf(program, operation);
	const bodyKey = placement.rawBodyProperty ?? placement.bodyProperty;
	if (bodyKey !== undefined) {
		inputs.push({
			key: bodyKey,
			location: "body",
			target: requestBodyParameterOf(operation)?.property ?? operation.operation,
		});
	}
	const shared: SharedInputKey[] = [];
	inputs.forEach((input, index) => {
		const first = inputs.slice(0, index).find((earlier) => earlier.key === input.key);
		if (first === undefined) return;
		shared.push({ key: input.key, first: first.location, second: input.location });
		const format = {
			operation: operationIdOf(program, operation.operation),
			key: input.key,
			first: INPUT_LOCATION_NOUNS[first.location],
			second: INPUT_LOCATION_NOUNS[input.location],
		};
		/**
		 * **Once per program, keyed on what the warning says.** Each emitter that runs the library
		 * collects its own operations, over types a visibility or version projection may have cloned,
		 * so neither the operation nor the declaration is the same object twice: `typespec-hono` beside
		 * `typespec-http-mcp` raised the warning twice per pair.
		 */
		const reported = sharedInputKeysReported.get(program) ?? new Set<string>();
		sharedInputKeysReported.set(program, reported);
		const said = JSON.stringify(format);
		if (reported.has(said)) return;
		reported.add(said);
		reportDiagnostic(program, {
			code: "shared-input-key",
			// One location, one value on the wire: the document publishes the first declaration.
			messageId: first.location === input.location ? "repeated" : "default",
			target: input.target,
			format,
		});
	});
	sharedInputKeys.set(operation, shared);
	return shared;
}

const sharedInputKeys = new WeakMap<HttpOperation, readonly SharedInputKey[]>();
const sharedInputKeysReported = new WeakMap<Program, Set<string>>();

function requestBodyPlacementOf(
	program: Program,
	operation: HttpOperation,
): {
	readonly rawBodyProperty: string | undefined;
	readonly rawBodyBinary: boolean;
	readonly rawBodyUnvalidated: boolean;
	readonly bodyProperty: string | undefined;
	readonly optionalBody: boolean;
} {
	reportNeverBody(program, operation, operation.parameters.body, "request");
	const requestType = requestBodyOf(operation);
	const bodyParameter = requestBodyParameterOf(operation);
	const contentTypes = [...(bodyParameter?.contentTypes ?? [])];
	/**
	 * A `bytes` body means the BYTES are the contract.
	 *
	 * A signature over the body covers exactly what arrived, so a parsed-and-re-serialised object
	 * would verify a different string and every signed request would fail authentication.
	 */
	const bytes = requestType?.kind === "Scalar" && program.checker.isStdType(requestType, "bytes");
	/**
	 * **A body declared only under media types nothing can parse into it is handed over raw.** A
	 * model as `application/xml` has no serialisation this emitter can derive, and the server has no
	 * reader for it; it used to get a header check and then call the handler with the body never
	 * read, while the warning beside it said such requests were refused. Handed over as it arrived,
	 * the handler parses it - exactly what the response side already asks of a handler serving a model
	 * as XML. It is the text under a textual media type and the bytes under any other
	 * (`rawBodyBinary`). A string body is not this: it IS text, and its schema still checks it
	 * (`requestTextual`).
	 */
	const unparseable =
		bodyParameter?.bodyKind === "single" &&
		requestType !== undefined &&
		!bytes &&
		!isStringType(requestType) &&
		contentTypes.length > 0 &&
		contentTypes.every((type) => !isParseableMediaType(type));
	/**
	 * **An `Http.File` body is raw too: the file's contents ARE the body.** `@typespec/openapi3`
	 * publishes it as `content: { "image/png": { schema: { contentMediaType: "image/png" } } }` - a
	 * media type and no type, nothing to parse and nothing to validate - which is exactly a `bytes`
	 * body under that media type. `requestBodyOf` reads only `bodyKind === "single"`, so a file body
	 * reached no placement at all: the handler was passed `{}` and the upload was dropped, from a
	 * compile that reported success, on all four uploads in `type/file`.
	 */
	const rawBodyProperty =
		bytes || bodyParameter?.bodyKind === "file" || unparseable
			? (bodyParameter?.property?.name ?? "body")
			: undefined;
	/**
	 * A body with an indexer is named rather than spread - see `bodyProperty`. Read from the
	 * resolved model's own indexer rather than from the emitted schema text, which would be a
	 * decision made by pattern-matching generated output.
	 */
	/**
	 * **An OPTIONAL body is named for the same reason an indexed one is**: the merge cannot
	 * express "absent". See {@link EmittedRoute.optionalBody}.
	 */
	const optionalBody = bodyParameter?.property?.optional === true;
	/**
	 * **An optional MULTIPART body reaches the same rule by a second route, because
	 * `requestType` cannot see it.** `requestBodyOf` resolves a type only for
	 * `bodyKind === "single"`, so `requestType` is `undefined` for every multipart operation
	 * and the `optionalBody` disjunct above was unreachable however the document declared it.
	 *
	 * The emitted server for such an operation did not compile. Measured, and the mechanism is
	 * worth stating because it is not a union: spreading a value typed `Parts | undefined`
	 * makes every part OPTIONAL, so `{ file?: ...; pages?: ... }` was passed where
	 * `{ file: ...; pages: ... }` was required. `TS2345`, inside `app.gen.ts` itself.
	 *
	 * That is the failure {@link EmittedRoute.optionalBody} predicts in prose - a merge has no
	 * way to say "these properties are here only sometimes" without making every one of them
	 * optional, which is a weaker and different claim about the body that IS sent. So this is
	 * the stated rule reaching the one body kind it had never been applied to, not a new rule.
	 *
	 * **The REQUIRED arm is deliberately excluded.** The indexed reason does not apply to a
	 * parts model, so a required multipart body merges as safely as a required single one, and
	 * `typespec-hono/test/filepart/` compiles a handler that reads `input.file` directly.
	 * Widening this to "multipart is always named" would rewrite that directory for no defect.
	 *
	 * This is the third hole the `"single"` gate has produced, after `multipartSchemaOf` and
	 * `multipartTsOf`, both recorded above.
	 */
	const optionalMultipartBody = bodyParameter?.bodyKind === "multipart" && optionalBody;
	/**
	 * **A body that is not a MODEL has no properties to merge, and merging it anyway lost it.**
	 *
	 * `@body body: string` emitted a handler input of `Record<string, never>` and a call site of
	 * `{}`: the server validated the body and then never handed it to the handler, silently, from
	 * a compile that reported success. `@body body: SomeEnum` was the same rule failing loudly,
	 * `TS2698: Spread types may only be created from object types`, which is what
	 * `payload/media-type`, `type/enum/*`, `type/scalar` and `versioning/returnTypeChangedFrom`
	 * had been pinned on in the conformance corpus.
	 *
	 * A scalar, an enum, a union or a literal body is therefore NAMED, which is the treatment an
	 * indexed or optional body already gets and for the same reason: the merge cannot express it.
	 *
	 * **Except a `bytes` body**, which {@link EmittedRoute.rawBodyProperty} already names, and
	 * naming it twice would put the same value under two keys.
	 */
	const unmergeableBody =
		requestType !== undefined && requestType.kind !== "Model" && rawBodyProperty === undefined;
	/**
	 * **A body sharing a key with a parameter is named, because merged one value replaces the
	 * other.** `PUT /renames/{name}` with a body `{ name }` handed the handler one `name`, the body's,
	 * and the path's was lost with nothing reported - in `parameters/spread`'s composite request, and
	 * in any spec whose body repeats a path or query parameter. The document states the two
	 * separately; named, the handler is given both. The body's keys are the keys its validator
	 * declares - see `mergedBodyKeysOf` - so a read-only `id` shared into the request, still required
	 * under OAS 3.1's reading, collides with `@path id` as any other key does.
	 */
	const parameterNames = new Set(
		publishedParametersOf(operation).map((parameter) => parameter.name),
	);
	const collides =
		rawBodyProperty === undefined &&
		mergedBodyKeysOf(program, operation).some((key) => parameterNames.has(key));
	const bodyProperty =
		(requestType?.kind === "Model" && (requestType.indexer !== undefined || optionalBody)) ||
		optionalMultipartBody ||
		unmergeableBody ||
		collides
			? (bodyParameter?.property?.name ?? "body")
			: undefined;
	/**
	 * A file is handed over as a stream of bytes whatever its media type. `@typespec/http` lets an
	 * emitter represent a textual file "as strings or streams of textual characters", and one
	 * representation for every file is what lets a file declared `application/json` be told from a
	 * JSON body - which the media type alone cannot do.
	 *
	 * **A body nothing parses is bytes unless every type it is declared under is text.** Decoded as
	 * text, `application/octet-stream` lost every byte that is not valid UTF-8; see
	 * {@link isTextualMediaType}.
	 */
	const rawBodyBinary =
		rawBodyProperty !== undefined &&
		(unparseable
			? !contentTypes.every(isTextualMediaType)
			: bodyParameter?.bodyKind === "file" || isRawBinaryMediaType(contentTypes));
	return {
		rawBodyProperty,
		rawBodyBinary,
		rawBodyUnvalidated: unparseable,
		bodyProperty,
		optionalBody,
	};
}

export function collectRoutes(
	program: Program,
	registry: SchemaRegistry,
	service: HttpService,
): EmittedRoute[] {
	return withServiceView(program, service.namespace, () =>
		collectServiceRoutes(program, registry, service),
	);
}

function collectServiceRoutes(
	program: Program,
	registry: SchemaRegistry,
	service: HttpService,
): EmittedRoute[] {
	const routes: EmittedRoute[] = [];
	reportUnpublishable(program, service.namespace);
	{
		for (const operation of service.operations) {
			/**
			 * **Every operation is a route, whatever its responses are.** This used to require an exact
			 * 2xx or 3xx, which dropped an operation whose only success was a `2XX` range without a word
			 * - the same silent shape as the 282 bodyless operations an earlier rule dropped, because a
			 * range is not a number. A bodyless success is ordinary HTTP, and so is a ranged one.
			 */
			const statusCode = successStatusOf(operation);
			const requestType = requestBodyOf(operation);
			/**
			 * **A streamed operation's EVENT payloads are not reachable from its body.**
			 *
			 * `op receive(): SSEStream<UnnamedEvents>` has a response body of `string` - the event
			 * stream - so the walk above sees a scalar and stops, and `Unnamed.Info` gets no validator
			 * even though the document publishes it as a component. Declaring the union here reaches
			 * every payload through it, which is the same set openapi3 emits. The result is discarded:
			 * the route's response schema is still the stream, and this exists so the vocabulary a
			 * consumer needs to check each `data:` against is actually generated.
			 */
			const streamed = streamedTypeOf(program, operation.operation.returnType);
			if (streamed !== undefined) {
				withVisibility(Visibility.Read, () => registry.expressionFor(streamed));
			}
			// `@requestVisibility` when the operation states one, otherwise the verb's default - the
			// same resolution `@typespec/openapi3` performs before emitting a request schema.
			const requestVisibility = requestVisibilityOf(program, operation);
			const { rawBodyProperty, rawBodyBinary, rawBodyUnvalidated, bodyProperty, optionalBody } =
				requestBodyPlacementOf(program, operation);
			const authentication = authenticationFor(program, operation);
			const template = routeTemplateOf(
				operation.uriTemplate,
				// Every path parameter, a `never` included: the template still holds its expression.
				operation.parameters.parameters
					.filter((parameter) => parameter.type === "path")
					.map((parameter) => ({
						name: parameter.name,
						optional: parameter.param.optional,
						reserved: parameter.type === "path" && parameter.allowReserved,
					})),
			);
			routes.push({
				operationId: operationIdOf(program, operation.operation),
				verb: operation.verb.toUpperCase(),
				/**
				 * The path TEMPLATE, exactly as the document publishes it - `/widgets/{widget-id}`.
				 *
				 * **This used to be a router's path, converted here.** `toHonoPath` ran during
				 * collection and rewrote `{widget-id}` to `:widget-id`, so the shared intermediate
				 * representation carried one framework's spelling of a contract fact - and a template
				 * that router could not mount refused the whole operation, validators included.
				 *
				 * A server emitter converts this when it renders, and refuses what it cannot mount with
				 * a diagnostic of its own. The validators for such an operation are still correct and
				 * still emitted: what a request body must look like does not depend on whether some
				 * particular router can express the path.
				 */
				path: operation.path,
				/**
				 * Asked of the resolved parameter, which is the only place both marker forms agree -
				 * see {@link EmittedRoute.reservedPathParameters}. `allowReserved` is a required
				 * boolean on every path parameter entry, so this reads a fact rather than an absence.
				 */
				reservedPathParameters: operation.parameters.parameters
					.filter((parameter) => parameter.type === "path" && parameter.allowReserved)
					.map((parameter) => parameter.name),
				pathSegments: template.segments,
				sharedInputKeys: sharedInputKeysOf(program, operation),
				decodedPathParameters: publishedParametersOf(operation)
					.filter(
						(parameter) => decodedSegmentOf(program, parameter, template.segments) !== undefined,
					)
					.map((parameter) => parameter.name),
				literalQuery: template.literalQuery,
				responseContentTypes:
					statusCode === undefined ? [] : responseContentTypesOf(operation, statusCode),
				requestContentTypes: [...(requestBodyParameterOf(operation)?.contentTypes ?? [])],
				// `isRawBinaryMediaType` is "every declared type is non-JSON", which is the same question
				// here: a string body under `application/json` IS json, and its reader is the JSON one.
				requestTextual:
					requestType !== undefined &&
					rawBodyProperty === undefined &&
					isStringType(requestType) &&
					isRawBinaryMediaType([...(requestBodyParameterOf(operation)?.contentTypes ?? [])]),
				/**
				 * `@summary` first, `@doc` as the fallback.
				 *
				 * OpenAPI distinguishes them - `summary` is the short line, `description` the verbose
				 * explanation - and `@typespec/openapi3` maps them to exactly those. A spec whose operation
				 * strings are one-liners means `summary`; written as `@doc` they land in `description`
				 * instead and leave `summary` empty on every operation. The fallback keeps a spec that
				 * uses `@doc` working.
				 */
				summary: getSummary(program, operation.operation) ?? getDoc(program, operation.operation),
				/**
				 * **Each position is walked at ITS OWN visibility, which is the whole point.** A model
				 * used as a request body and as a response is two shapes: `@statusCode` is applicable to
				 * one and not the other, and `@visibility` can add or remove properties outright. Walking
				 * both at one visibility gives whichever was seen first to both.
				 */
				...withVisibility(requestVisibility, () =>
					withRequestReading(program, requestVisibility, () => {
						// Multipart first: its body has no single type to walk, and skipping it left every
						// such route mounted with nothing checking the request at all.
						const parameterBody = requestBodyParameterOf(operation);
						if (parameterBody?.bodyKind === "multipart") {
							return {
								requestSchema: multipartRequestOf(
									program,
									registry,
									parameterBody,
									multipartSchemaOf(program, parameterBody, registry),
								),
								textParts: textPartsOf(program, parameterBody),
							};
						}
						if (requestType === undefined) return { requestSchema: undefined };
						reportAmbiguousReadOnly(program, requestType, requestVisibility);
						const declared = withMetadataAnnotationsIgnored(ignoresMetadata(parameterBody), () =>
							registry.expressionFor(requestType, true),
						);
						const form = formBodyOf(
							program,
							registry,
							operation,
							parameterBody,
							requestType,
							declared,
						);
						return form === undefined
							? { requestSchema: declared }
							: form.only
								? { requestSchema: form.schema }
								: { requestSchema: declared, formRequestSchema: form.schema };
					}),
				),
				...(() => {
					const split = withVisibility(requestVisibility, () =>
						parameterSchemasOf(
							program,
							operation,
							registry,
							template.segments,
							template.literalQuery.map(([name]) => name),
						),
					);
					return {
						cookieSchema: split.cookie,
						pathSchema: split.path,
						querySchema: split.query,
						queryFieldsSchema: split.queryFields,
						headerSchema: split.header,
						negotiatedHeaderSchema: split.negotiatedHeader,
						accept: split.accept,
					};
				})(),
				/**
				 * Read at `Visibility.Read`, as openapi3 reads a response, and after the request walks so
				 * declarations keep the order they had. Resolving responses under the ambient request
				 * visibility declared six components under the wrong suffix - measured:
				 * type/model/visibility gained six divergences.
				 */
				responses: withVisibility(Visibility.Read, () => responsesOf(program, operation, registry)),
				rawBodyProperty,
				rawBodyBinary,
				rawBodyUnvalidated,
				bodyProperty,
				optionalBody,
				scopes: authentication.scopes,
				security: authentication.security,
				authentication: authentication.authentication,
			});
		}
	}
	return routes;
}

type ExternalImports = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Emit only the external names a given file actually references.
 *
 * Both generated files can need them - `schemas.gen.ts` for the vocabulary tuples and `@refine`
 * predicates, and `routes.gen.ts` when an inline params schema carries a refined scalar.
 * Emitting the whole set into both would leave unused imports (which lint rejects); emitting it into
 * neither is what left `routes.gen.ts` referencing `isParsableInstant` with no import at all.
 */
/**
 * Every identifier the emitted source mentions.
 *
 * **Tokenised once on the language's own identifier rule, then tested by equality.** The question is
 * "does this file reference this name", and the two obvious ways to ask it are both wrong in ways
 * that only appear for particular names.
 *
 * A pattern built from the name is wrong when the name carries a regular-expression metacharacter.
 * `$` is a valid identifier character in JavaScript and in TypeSpec, and an anchor in a pattern, so
 * `new RegExp(`\b${name}\b`)` reports `foo$bar` absent from source that references it verbatim -
 * and the import is dropped, leaving the emitted module referencing an undeclared name. Escaping
 * alone does not fix it either, because `\b` is a WORD boundary and `$` is not a word character, so
 * there is no boundary before it to match.
 *
 * A substring test is wrong in the other direction: `Foo` is found inside `FooExtra`, emitting an
 * import the file never uses. That one fails loudly at lint, which makes it the better mistake, but
 * it is still a mistake.
 *
 * Tokenising has neither, needs no escaping to stay correct, and is one pass rather than one pattern
 * per name. Without it, a spec whose every identifier carries a `$` emits a file that imports nothing
 * and does not compile.
 *
 * **Only CODE is tokenised: string, template and regular-expression literals and comments are
 * skipped.** Spec-authored text reaches emitted source inside them - a `.describe("...")`, a
 * `.regex(/.../)` - and a word in that text is not a reference. Measured: a parameter documented as
 * "names uriExpansion and explodedQuery" declared both RFC 6570 decoders in a service that decodes
 * nothing, and the file failed `noUnusedLocals` - the lint a generated file has to pass like any
 * other. A literal is told from code by its opening character; a `/` opens a regular expression only
 * where an expression may start, which is the rule a JavaScript scanner uses, and this emitter
 * writes no division.
 */
function identifiersIn(source: string): ReadonlySet<string> {
	const found = new Set<string>();
	scanCode(source, 0, found, false);
	return found;
}

/**
 * Collect the identifiers of the code from `start`, returning where it stopped: at the end, or -
 * `nested`, for a template's `${...}` - just past the brace that closes it.
 */
function scanCode(source: string, start: number, found: Set<string>, nested: boolean): number {
	const identifier = /[A-Za-z_$][A-Za-z0-9_$]*/y;
	let previous = "";
	let depth = 0;
	let index = start;
	while (index < source.length) {
		const char = source.charAt(index);
		const next = source.charAt(index + 1);
		if (char === "`") {
			index = scanTemplate(source, index, found);
			previous = char;
		} else if (char === '"' || char === "'") {
			index = quotedEnd(source, index, char);
			previous = char;
		} else if (char === "/" && next === "/") {
			const end = source.indexOf("\n", index);
			index = end === -1 ? source.length : end;
		} else if (char === "/" && next === "*") {
			const end = source.indexOf("*/", index + 2);
			index = end === -1 ? source.length : end + 2;
		} else if (char === "/" && (previous === "" || "(,=:[!&|?{};".includes(previous))) {
			index = regexEnd(source, index);
			previous = char;
		} else if (/[A-Za-z_$]/.test(char)) {
			identifier.lastIndex = index;
			const [name = char] = identifier.exec(source) ?? [];
			found.add(name);
			index += name.length;
			previous = "a";
		} else {
			if (char === "}" && nested && depth === 0) return index + 1;
			if (char === "{") depth += 1;
			if (char === "}") depth -= 1;
			if (!/\s/.test(char)) previous = char;
			index += 1;
		}
	}
	return index;
}

/** Past a template literal opened at `start`, collecting the code in each `${...}` on the way. */
function scanTemplate(source: string, start: number, found: Set<string>): number {
	let index = start + 1;
	while (index < source.length) {
		const char = source.charAt(index);
		if (char === "\\") index += 2;
		else if (char === "`") return index + 1;
		else if (char === "$" && source.charAt(index + 1) === "{") {
			index = scanCode(source, index + 2, found, true);
		} else index += 1;
	}
	return index;
}

/** Past a quoted string opened at `start`, escapes honoured. */
function quotedEnd(source: string, start: number, quote: string): number {
	for (let index = start + 1; index < source.length; index += 1) {
		const char = source.charAt(index);
		if (char === "\\") index += 1;
		else if (char === quote) return index + 1;
	}
	return source.length;
}

/** Past a regular-expression literal opened at `start`, flags included. */
function regexEnd(source: string, start: number): number {
	let inClass = false;
	for (let index = start + 1; index < source.length; index += 1) {
		const char = source.charAt(index);
		if (char === "\\") index += 1;
		else if (char === "[") inClass = true;
		else if (char === "]") inClass = false;
		else if (char === "/" && !inClass) {
			let end = index + 1;
			while (/[a-z]/.test(source.charAt(end))) end += 1;
			return end;
		}
	}
	return source.length;
}

/** Whether emitted source references `name` as an identifier rather than as part of a longer one. */
export function referencedIn(source: string, name: string): boolean {
	return identifiersIn(source).has(name);
}

function renderExternalImports(externals: ExternalImports, ...bodies: string[]): string {
	const haystack = bodies.join("\n");
	const lines: string[] = [];
	for (const [module, names] of externals) {
		const used = [...names].filter((name) => referencedIn(haystack, name));
		if (used.length > 0) {
			lines.push(`import { ${used.toSorted().join(", ")} } from ${literal(module)};\n`);
		}
	}
	return lines.join("");
}

/**
 * Every validator this service needs, in one module: the component schemas, and the per-operation
 * request and response validators.
 *
 * **The per-operation half is emitted here, not by a server generator into its server file.** Left
 * to a server, a package advertising *TypeSpec HTTP -> Zod* would produce component schemas and
 * nothing a caller could validate a request or a response against, and every oracle grading those
 * validators would have to read a server to find them. See {@link nameRouteSchemas}.
 */
/**
 * **`z.compile(...)` around a validator, when `compile-schemas` asks for it.**
 *
 * Zod walks the schema once and emits a flat, loop-free function through `new Function`, falling back
 * to the ordinary parser for anything it cannot handle. Measured on zod 4.5.2 before this was written:
 * `z.toJSONSchema` output is byte-identical, `_zod.def` is unchanged and still readable, and verdicts
 * AND parsed output match for every construct this emitter writes - including `z.preprocess`,
 * `.exactOptional()` and a `z.lazy()` cycle. So the two oracles that read a schema rather than run it
 * are unaffected, and the wrapper is transparent.
 *
 * **A cyclic declaration is wrapped too, and that was worth checking rather than assuming.** The
 * emitted form names the const being defined from inside its own `z.lazy()` body, and a break of
 * exactly that shape is known - `.strict()` reads `shape` eagerly and throws
 * `Cannot access 'X' before initialization` during module initialisation. Measured on the emitted
 * shape: `z.compile()` does not force the lazy body, and the declaration parses.
 */
function compiled(expression: string, on: boolean): string {
	return on ? `z.compile(${expression})` : expression;
}

function renderSchemas(
	registry: SchemaRegistry,
	externals: ExternalImports,
	routeDeclarations: readonly string[],
	compileSchemas: boolean,
): string {
	const declarations = registry.declarations().map((d) => {
		/**
		 * **A declaration on a CYCLE cannot take its type from `z.infer`, because that is the loop.**
		 * The ordinary form - `const x = ...; type X = z.infer<typeof x>` - is circular the moment `x`'s
		 * own initialiser depends on `X`, and TypeScript says so: `TS2456`, `TS2502`, `TS7022`. So a
		 * cyclic declaration carries the type written out, and the deferred one is annotated with it,
		 * which is the recipe Zod documents for exactly this. Everything else is unchanged, so a spec
		 * with no cycle emits byte-identical output to before.
		 */
		if (d.structural === undefined) {
			return `\nexport const ${d.identifier} = ${compiled(d.source, compileSchemas)};\nexport type ${d.typeName} = z.infer<typeof ${d.identifier}>;\n`;
		}
		// One object literal is an interface; a union of them - an envelope's wrappers - is not.
		const declared = isSingleObjectLiteral(d.structural)
			? `export interface ${d.typeName} ${d.structural}`
			: `export type ${d.typeName} = ${d.structural};`;
		/**
		 * **BOTH of Zod's type parameters, and naming only the first left the second as `unknown`.**
		 *
		 * `z.ZodType<T>` is `ZodType<Output = T, Input = unknown>`, so a schema annotated with one
		 * parameter reports `z.input<typeof x>` as `unknown` - and every schema that REFERENCES it
		 * inherits that. Measured: `Identical<Declared<z.input<typeof nodeSchema>>, Contracts.Node>`
		 * failed on `branch?: unknown | undefined` against `branch?: Branch | undefined`, in a fixture
		 * whose two artefacts agree about every property. The wire assertion pairs `z.input` because
		 * that is what a caller supplies, so an unannotated input parameter takes the whole cyclic
		 * corner of the emitter out of that comparison.
		 *
		 * **One structural type serves both positions, and for a defaulted property on a cycle it is
		 * the INPUT shape that both get.** A default is the only construct where a schema's input and
		 * output types differ, and a cyclic declaration has exactly one type written out to name - the
		 * loop is what stops `z.infer` being usable at all. Claiming the input shape in the output
		 * position is the PERMISSIVE direction: every value that arrives still satisfies it, a reader
		 * simply learns less than it could about a defaulted property. Claiming the output shape in
		 * the input position is the restrictive one, and it is the defect this avoids - a caller told
		 * to supply what the document says they may omit.
		 *
		 * So the limitation is confined to this: a model on a cycle carrying a defaulted optional
		 * property exports a type from `schemas.gen.ts` that is weaker than what arrives, by exactly
		 * that property. `typespec-hono` derives its handler input from `z.infer` of the schema rather
		 * than from this type, so no handler signature is affected.
		 */
		const annotation = d.annotated === true ? `: z.ZodType<${d.typeName}, ${d.typeName}>` : "";
		/**
		 * **A deferred declaration is NEVER compiled, and this was measured rather than reasoned.**
		 *
		 * `z.lazy()` is on Zod's own list of constructs the compiler cannot handle, and here the body
		 * forward-references a `const` declared further down the module. Wrapping it emitted output that
		 * loaded fine and then threw `Cannot read properties of undefined (reading '_zod')` on the first
		 * parse - the walk captures the reference while it is still in the temporal dead zone, so the
		 * failure surfaces at request time rather than at import.
		 *
		 * **CYCLE MEMBERSHIP decides this, not deferral, and that took a zod upgrade to learn.**
		 *
		 * It was keyed on `annotated` - set exactly when the declaration is deferred, which is exactly
		 * when `z.lazy()` is written - on the measurement that a model whose back edge sits on a GETTER
		 * compiled and parsed fine. That was true on zod 4.5.2 and is false on 4.6.5, which made the
		 * recursive parse state weak. The failure moved from the deferred declaration to the one that
		 * REFERENCES it, which was still being compiled:
		 *
		 * ```
		 * const branchSchema = z.lazy(() => z.union([nodeSchema, z.string()]));
		 * const nodeSchema = z.compile(z.strictObject({ ..., branch: branchSchema.exactOptional() }));
		 * nodeSchema.safeParse({ label: "a", attributes: {} });
		 * zod 4.5.2: true
		 * zod 4.6.5: TypeError: Cannot read properties of undefined (reading '_zod')
		 * ```
		 *
		 * Bisected: naming a compiled schema from inside a `z.lazy()` body is the whole trigger, and
		 * the self-referencing getter is not needed for it. So the same rule the registry already
		 * applies to structural types applies here - every member of the cycle, not only the deferred
		 * one - and `structural` is the fact it already holds for exactly that set.
		 *
		 * The peer range admits 4.6, so without this the failure surfaces on a running server's first
		 * parse.
		 */
		return `\n${declared}\nexport const ${d.identifier}${annotation} = ${compiled(d.source, compileSchemas && d.structural === undefined)};\n`;
	});
	/**
	 * **Written only when something in the file names it**, like the `ResponseArm` import below and for
	 * the same reason: an unused import fails the lint a generated file has to pass like any other.
	 *
	 * `z` is reached through a declaration's source or a route arm's schema, and a service whose every
	 * operation takes nothing and returns `void` has neither: its arms are
	 * `{ status: 204, schema: undefined }`, which names nothing.
	 * `TS6133: 'z' is declared but its value is never read`, from a compile that reported success. A
	 * health check of two bare `GET`s is exactly such a service.
	 *
	 * **Counting declarations is not sufficient and was the first attempt.** A void-only service HAS
	 * route declarations; they simply do not use Zod. The content decides, and it is TOKENISED on the
	 * language's own identifier rule rather than searched for a substring, so `z` cannot be found
	 * inside `zValidator` or missed beside a bracket. `renderExternalImports` below reads the same
	 * rendered content for the same reason.
	 */
	/**
	 * **`Exact<>` lived here until `0.24.0`, and `z.exactOptional()` replaced it.**
	 *
	 * It was a mapped type over `z.infer` that stripped `| undefined` off every optional property,
	 * because `.optional()` infers `p?: T | undefined` and **JSON has no `undefined`** - the document
	 * says "absent or a value" by leaving the property out of `required`, so the inferred type was
	 * wider than both the document and the wire.
	 *
	 * The reasoning was right and it was applied to only one of the two artefacts. The VALIDATOR went
	 * on accepting `{ p: undefined }`, so one program published a type refusing a value beside a
	 * validator admitting it, compared by nothing. Emitting `.exactOptional()` makes `z.infer` produce
	 * `p?: T` directly - at every depth, which a shallow mapped type never reached - so the narrowing
	 * happens once, in the schema, and this helper has nothing left to do.
	 *
	 * The contract types in `requests.gen.ts` say the same since `0.28.0`: `?: T`, and
	 * `?: T | undefined` only where `.default()` accepts an explicit `undefined`. They had kept it
	 * everywhere on reasons that stopped holding once this schema moved - see `propertyToTs`.
	 */
	const usesZod = new Set(
		[...declarations, ...routeDeclarations].join("").match(/[A-Za-z_$][\w$]*/g) ?? [],
	).has("z");
	const parts = [generatedBanner()];
	if (usesZod || routeDeclarations.length > 0) parts.push('\nimport { z } from "zod";\n');
	/**
	 * **The arm shape is declared IN this file, not imported, and that is what lets two emitters share
	 * it.** It used to be `import type { ResponseArm } from <runtime-module>`, the one line of this
	 * file that depended on where a runtime lived. A server emitter and a tool emitter pointed at one
	 * output directory both write `schemas.gen.ts`, and `emitFile` is a silent last-writer-wins, so the
	 * two had to agree on that specifier or the order of `emit:` decided which import survived. With
	 * the shape declared here the file depends on no runtime at all, and `runtime-module` had nothing
	 * left to decide.
	 *
	 * The annotation is still what makes a misspelled or omitted `schema` a compile error rather than
	 * an arm that silently validates nothing. Not exported: the type an application reads an arm
	 * through is `typespec-http-zod/runtime`'s, which is structurally the same. Emitted only where
	 * there are arms to annotate, because an unused declaration fails the lint a generated file has to
	 * pass like any other.
	 */
	parts.push(renderExternalImports(externals, [...declarations, ...routeDeclarations].join("")));
	/**
	 * **The RFC 6570 decoders are declared here, once, and only where a validator calls them**, for the
	 * reason `z` is imported only when used: an unused declaration fails the lint a generated file has
	 * to pass. Declared rather than imported, so this file still depends on no runtime.
	 */
	const referenced = identifiersIn([...declarations, ...routeDeclarations].join(""));
	// Both decoders read their values through `wireRead`, so it is declared beside either.
	const expands =
		referenced.has("uriExpansion") ||
		referenced.has("explodedQuery") ||
		referenced.has("wireReadObject");
	// And `wireReadAs` reads through `wireRead`, which a multipart text part calls on its own.
	const readsAs = expands || referenced.has("wireReadAs");
	if (readsAs || referenced.has("wireRead")) parts.push(WIRE_READ_SOURCE);
	if (readsAs) parts.push(WIRE_READ_AS_SOURCE);
	if (expands) parts.push(WIRE_READERS_SOURCE);
	if (referenced.has("uriExpansion")) parts.push(URI_EXPANSION_SOURCE);
	if (referenced.has("explodedQuery")) parts.push(EXPLODED_QUERY_SOURCE);
	if (referenced.has("wireReadObject")) parts.push(WIRE_READ_OBJECT_SOURCE);
	if (referenced.has("wireItself")) parts.push(WIRE_ITSELF_SOURCE);
	if (routeDeclarations.length > 0) {
		parts.push(`
/** One declared response: its status key, its body's schema, its media types and its headers. */
type ResponseArm = {
	readonly status: number | "default" | \`\${1 | 2 | 3 | 4 | 5}XX\`;
	readonly schema: z.ZodType | undefined;
	readonly contentTypes?: readonly string[];
	readonly headers?: readonly { readonly name: string; readonly optional: boolean }[];
};
`);
	}
	parts.push(declarations.join(""));
	if (routeDeclarations.length > 0) parts.push(`\n${routeDeclarations.join("\n")}\n`);
	return parts.join("");
}

/**
 * The IDENTIFIER a schema can be referred to by, which `z.infer<typeof ...>` requires.
 *
 * A route's schema is often an expression rather than a declaration - `z.array(widgetSchema)`,
 * `z.object({...})` for inline parameters - and `typeof z.array(widgetSchema)` is not valid
 * TypeScript. Anything that is not already a bare identifier gets a name here; anything that is
 * keeps it, so the generated file does not fill up with aliases that alias nothing.
 */
const isIdentifier = (expression: string): boolean => /^[A-Za-z_$][\w$]*$/.test(expression);

/**
 * The identifier a route's validator is exported under: the operation's id and the part it checks.
 *
 * **Never one of the helpers the module declares beside it.** An operation named `exploded` has a
 * query validator called `explodedQuery`, which is also the name of the function that gathers an
 * exploded query object, and the module did not parse. Such a name takes a trailing `_`, as a model
 * named after an emitted helper does.
 */
const schemaConst = (operationId: string, suffix: string, taken: Set<string>): string => {
	/**
	 * **And always an identifier, and never one already taken.** `@operationId("get-widget")` is a
	 * valid id and not a valid name: `export const get-widgetQuery` did not parse. Each character no
	 * identifier may hold becomes `_`, and a name another operation already took - `get_widget`
	 * beside `get-widget` - takes one more.
	 */
	let name = `${operationId.replace(/[^\w$]/g, "_").replace(/^(\d)/, "_$1")}${suffix}`;
	while (EMITTED_FUNCTIONS.has(name) || taken.has(name)) name = `${name}_`;
	taken.add(name);
	return name;
};

/**
 * Text written inside a block comment, which `*\/` would end: `@operationId("list*\/items")` is a
 * valid id, and the comment naming it closed early and left the rest of the line as code.
 */
function commentSafe(text: string): string {
	// And printable ASCII, as every generated file is: a letter outside it is written as its escape.
	return text
		.replaceAll("*/", "*\\/")
		.replace(/[^\x20-\x7e]/gu, (each) => `\\u{${(each.codePointAt(0) ?? 0).toString(16)}}`);
}

/** The functions a schemas module may declare for itself - see `helperSources`. */
const EMITTED_FUNCTIONS: ReadonlySet<string> = new Set([
	"uriExpansion",
	"explodedQuery",
	"wireRead",
	"wireReadAs",
	"wireReaderOf",
	"wireReadObject",
	"wireItself",
	"wireSentAsItself",
]);

/** `[the name to refer to it by, the `const` line to emit]` - the line is absent when none is needed. */
function namedSchema(
	operationId: string,
	suffix: string,
	expression: string | undefined,
	compileSchemas: boolean,
	taken: Set<string>,
): { readonly name: string | undefined; readonly declaration: string | undefined } {
	if (expression === undefined) return { name: undefined, declaration: undefined };
	if (isIdentifier(expression)) return { name: expression, declaration: undefined };
	const name = schemaConst(operationId, suffix, taken);
	/**
	 * **Exported, because a schema nothing outside this file can name is a schema nothing can
	 * check.** These are the validators the server actually enforces on every request - the path,
	 * query and header shapes - and while they were module-local the only thing that could read them
	 * was the generated code itself. That is how a header validator keyed on the wrong name shipped:
	 * the conformance differential compares `components.schemas`, a parameter schema is not a
	 * component, and there was no third artefact to compare against even in principle.
	 *
	 * Exporting also gives an application the request shape by name, which is what the per-operation
	 * type aliases will be built from.
	 */
	return { name, declaration: `export const ${name} = ${compiled(expression, compileSchemas)};` };
}

/**
 * The identifiers a route's validators are declared under, by what the DOCUMENT calls each one.
 *
 * **Keyed on request locations, not on a router's validator targets.** `@hono/zod-validator`
 * spells these `"param"`, `"query"`, `"header"`, `"json"`; another framework spells them differently
 * or not at all. The location is the contract fact and belongs here; the spelling is the server
 * emitter's, and translating one to the other is a two-line map in the package that knows.
 */
export interface RouteSchemaNames {
	readonly operationId: string;
	readonly path: string | undefined;
	readonly query: string | undefined;
	/**
	 * The query object's identifier, with a `.shape`. Equal to `query` except where a form-exploded
	 * record or model is gathered, when `query` is `z.preprocess(gather, <queryFields>)` and has no
	 * `.shape`. A consumer spreading request fields reads this; a validator of a raw request reads `query`.
	 */
	readonly queryFields: string | undefined;
	readonly header: string | undefined;
	/**
	 * **The `accept` the negotiation selects this operation by**, on a route several operations
	 * share. `header` leaves it out there, because it chooses the operation rather than constraining
	 * one, and the operation's input still declares it: the one value that reaches this operation is
	 * its own literal, so a handler receives exactly that. `undefined` wherever `header` validates
	 * `accept` itself, or the operation declares no literal one.
	 */
	readonly selectedAccept: { readonly name: string; readonly value: string } | undefined;
	/**
	 * Cookie parameters. **Optional on the interface, so a server emitter that does not read it yet
	 * still compiles** - this arrived after the other four and two emitters consume this type.
	 */
	readonly cookie?: string | undefined;
	readonly body: string | undefined;
	/**
	 * The validator of the body as a URL-encoded form carries it, where it differs from `body`'s - see
	 * {@link EmittedRoute.formRequestSchema}. Absent where a form, if one is declared, is validated by
	 * `body`.
	 */
	readonly formBody?: string;
	/**
	 * The identifier each response's body is declared under, parallel to `EmittedRoute.responses` and
	 * in the same order. `schema` is `undefined` exactly where that response carries no body.
	 *
	 * **An identifier for every arm, failures included.** A success body used to be named and a
	 * failure's inline body stayed an expression inside the arm list, so a server emitter could not
	 * write `z.infer<typeof ...>` for the one response it most needs a handler to be able to return.
	 */
	readonly arms: readonly {
		readonly status: StatusKey;
		readonly schema: string | undefined;
		/**
		 * The identifier holding this status's declared response headers, where it declares any.
		 * **Optional on the interface**, so a server emitter that does not check them yet still builds.
		 */
		readonly headers?: string | undefined;
	}[];
	/**
	 * The `readonly ResponseArm[]` const - what the operation may answer with, and with which body.
	 *
	 * Always present, because every operation declares at least its success status. An operation whose
	 * every arm is bodyless still gets the const, carrying `schema: undefined` per arm, which is the
	 * document's own answer rather than an absence a consumer has to interpret.
	 */
	readonly responses: string;
}

/**
 * Which `verb path` slots carry more than one operation.
 *
 * **A DOCUMENT fact, not a router one, which is why it lives here.** TypeSpec models content
 * negotiation as several operations on one route; OpenAPI models it as a single path item whose
 * response lists every media type. A route reached that way must not validate `accept` against any
 * one member's literal - `accept` SELECTS the operation, so validating it would answer `400` to a
 * well-formed request whose real answer is `406`. That is why `negotiatedHeaderSchema` exists, and
 * deciding which of the two applies is what this set is for.
 */
function sharedSlots(routes: readonly EmittedRoute[]): ReadonlySet<string> {
	const shared = new Set<string>();
	const seen = new Set<string>();
	for (const route of routes) {
		const slot = `${route.verb} ${route.path}`;
		if (seen.has(slot)) shared.add(slot);
		seen.add(slot);
	}
	return shared;
}

/**
 * Declare every per-operation validator, and hand back the names they were declared under.
 *
 * **Declared here, not by a server emitter into its server file.** Six identifiers per operation -
 * the path, query and header validators, the request body, the success response and the response
 * arms. Declared by a server emitter instead, three things would follow:
 *
 * 1. a package whose entire claim is *TypeSpec HTTP -> Zod* would emit **no** request or response
 *    validator that a caller could name. Component schemas, and nothing to check a call against;
 * 2. every oracle grading them would have to read the SERVER file, and without one the parameter,
 *    response and response-body arms would go unmeasured, leaving component agreement as the only
 *    thing still compared;
 * 3. two emitters would have to mint identical identifiers by coincidence.
 *
 * Declaring them here dissolves all three: the library mints the names AND emits them, and a server
 * emitter imports what it is told rather than agreeing about it.
 */
function nameRouteSchemas(
	routes: readonly EmittedRoute[],
	compileSchemas: boolean,
): {
	readonly names: ReadonlyMap<string, RouteSchemaNames>;
	readonly declarations: readonly string[];
} {
	const shared = sharedSlots(routes);
	const declarations: string[] = [];
	const taken = new Set<string>();
	const names = new Map<string, RouteSchemaNames>();
	for (const route of routes) {
		const declare = (suffix: string, expression: string | undefined): string | undefined => {
			const resolved = namedSchema(route.operationId, suffix, expression, compileSchemas, taken);
			if (resolved.declaration !== undefined) declarations.push(resolved.declaration);
			return resolved.name;
		};
		// Order follows the request: what identifies the resource, then what filters it, then its body.
		const path = declare("Path", route.pathSchema);
		/**
		 * Where a query group is gathered, its object is declared on its own and the wire validator wraps
		 * that identifier, so both have a name and only the second pipes.
		 */
		const gathers =
			route.queryFieldsSchema !== undefined && route.querySchema !== route.queryFieldsSchema;
		const queryFields = gathers ? declare("QueryFields", route.queryFieldsSchema) : undefined;
		const query = declare(
			"Query",
			gathers && queryFields !== undefined && route.queryFieldsSchema !== undefined
				? route.querySchema?.replace(route.queryFieldsSchema, queryFields)
				: route.querySchema,
		);
		const cookie = declare("Cookie", route.cookieSchema);
		const negotiating = shared.has(`${route.verb} ${route.path}`);
		const header = declare(
			"Header",
			negotiating ? route.negotiatedHeaderSchema : route.headerSchema,
		);
		// A raw body is read as text, never parsed, so it has no validator - the bytes are the contract.
		const body =
			route.rawBodyProperty === undefined ? declare("Body", route.requestSchema) : undefined;
		const formBody =
			route.rawBodyProperty === undefined
				? declare("FormBody", route.formRequestSchema)
				: undefined;
		/**
		 * One identifier per distinct body, suffixed by the status that first carries it. Two statuses
		 * sharing one inline body share its declaration rather than emitting it twice.
		 */
		const declaredBodies = new Map<string, string | undefined>();
		const arms = route.responses.map((response) => {
			const suffix = response.status === "default" ? "Default" : String(response.status);
			/**
			 * The headers this status declares, as one object schema, so a server can check what it is
			 * about to send the way it already checks the body.
			 *
			 * **A plain `z.object`, which strips.** A response carries headers the document does not
			 * declare - `Content-Type` among them, which the server sets itself - and those are not a
			 * contract violation. What is checked is that every header the document DOES declare carries
			 * a value the document permits.
			 */
			const headers =
				response.headers.length === 0
					? undefined
					: declare(
							`Response${suffix}Headers`,
							`z.object({\n${response.headers
								.map((header) => `\t${objectKey(header.name)}: ${header.schema},`)
								.join("\n")}\n})`,
						);
			if (response.schema === undefined) {
				return { status: response.status, schema: undefined, headers };
			}
			if (!declaredBodies.has(response.schema)) {
				declaredBodies.set(response.schema, declare(`Response${suffix}`, response.schema));
			}
			return { status: response.status, schema: declaredBodies.get(response.schema), headers };
		});
		const responses = schemaConst(route.operationId, "Responses", taken);
		declarations.push(
			`export const ${responses} = ${responseArmsOf(route, arms)} satisfies readonly ResponseArm[];`,
		);
		names.set(route.operationId, {
			operationId: route.operationId,
			path,
			query,
			queryFields: gathers ? queryFields : query,
			header,
			selectedAccept: negotiating ? route.accept : undefined,
			cookie,
			body,
			...(formBody === undefined ? {} : { formBody }),
			arms,
			responses,
		});
	}
	return { names, declarations };
}

/**
 * What an operation may answer with, as a literal - each declared status with the body, media types
 * and headers the document gives it, in OpenAPI's own precedence order.
 *
 * **Rendered from one record per status, so no arm can shadow another.** The primary success arm and
 * the failure arms used to be rendered from separate projections and then deduplicated by matching
 * the emitted text for `status:`, which is how a redirect came to be declared twice and how a
 * failure arm came to carry no headers while a success arm with the same headers did.
 *
 * `contentTypes` and `headers` are written only where the document names some, so "none declared"
 * and "none carried" are the same state rather than two a runtime has to tell apart.
 */
function responseArmsOf(
	route: EmittedRoute,
	arms: readonly { readonly status: StatusKey; readonly schema: string | undefined }[],
): string {
	const rendered = route.responses.map((response, index) => {
		const schema = arms[index]?.schema ?? "undefined";
		const contentTypes =
			response.contentTypes.length === 0
				? ""
				: `, contentTypes: [${response.contentTypes.map((type) => literal(type)).join(", ")}]`;
		const headers =
			response.headers.length === 0
				? ""
				: `, headers: [${response.headers.map((header) => `{ name: ${literal(header.name)}, optional: ${header.optional} }`).join(", ")}]`;
		return `{ status: ${literal(response.status)}, schema: ${schema}${contentTypes}${headers} }`;
	});
	return `[${rendered.join(", ")}]`;
}

/** One operation's responses, as the contract types state them. */
interface ResponseTypeEntry {
	readonly operationId: string;
	/** Every success body, as `WireOutputs` states it. */
	readonly output: string;
	/** Every member of the result, as `WireResults` states it. */
	readonly result: readonly string[];
	/** Whether either names `ByteStream`, so the file declares it. */
	readonly streams: boolean;
	/** The contract type of every body the result states, so the assertions can pair a model. */
	readonly bodyRefs: readonly string[];
}

/** One operation's input, as its handler receives it. */
interface RequestTypeEntry {
	readonly operationId: string;
	/** The body's type expression where it has one walked type, so the assertions can pair a model. */
	readonly bodyRef: string | undefined;
	/** The input's type, as `WireInputs` states it. */
	readonly input: string;
	/** Whether `input` names `ByteStream`, so the file declares it. */
	readonly streamsBody: boolean;
}

/**
 * Every operation's input, as TypeScript, exactly as a handler receives it.
 *
 * **One placement rule, the one the server emitters render from.** A model body is merged with the
 * path, query, header and cookie parameters; a body the merge cannot express is named under its
 * parameter's name, optional where the document lets it be absent; a `bytes` body is handed over
 * unread. {@link requestBodyPlacementOf} decides all three, for this walk and for
 * {@link EmittedRoute} alike. This walk used to merge every body, so for a union, an array, an
 * indexed model, an optional body, a scalar or an enum, `WireInputs` described an input no handler is
 * given.
 *
 * **Every operation, whatever it takes and whatever it answers.** An operation with no input is
 * `Record<string, never>`, which is what a handler for it is passed; one whose only success is a
 * range is as much an operation as any other. Both used to be skipped, so `keyof WireInputs` could
 * not enumerate a document's operations.
 *
 * **No parameter is left out by its name.** Dropping one because an application carries that value
 * in a context object rather than in the payload leaves the generated input type without it while the
 * Zod validator goes on requiring it: two artefacts describing different shapes, from a rule no
 * document states.
 */
/** A body type the contract declares by name, rather than spells inline: a model, union or enum. */
function declaresComponent(type: Type): boolean {
	return type.kind === "Model" || type.kind === "Union" || type.kind === "Enum";
}

function collectRequestTypes(
	program: Program,
	registry: TypeRegistry,
	service: HttpService,
): RequestTypeEntry[] {
	const entries: RequestTypeEntry[] = [];
	for (const operation of service.operations) {
		/**
		 * **Walked at the operation's REQUEST visibility, which is the whole point of this file.**
		 *
		 * `resolveRequestVisibility` is `@typespec/http`'s own answer - POST is Create, PATCH is
		 * Update, PUT is CreateOrUpdate - and it is what the Zod walk already uses at the route level.
		 * Without it this walk ran at the default `Read`, so a POST body's contract type carried the
		 * canonical property set while the validator beside it accepted the create projection. A
		 * caller satisfying the published type sent read-only fields and a strict validator answered
		 * 400.
		 *
		 * The predicates `propertyToTs` consults read the visibility `withVisibility` sets, and outside
		 * one they read `Read`.
		 */
		withVisibility(requestVisibilityOf(program, operation), () =>
			withRequestReading(program, requestVisibilityOf(program, operation), () => {
				const body = requestBodyOf(operation);
				const placement = requestBodyPlacementOf(program, operation);
				/** The parts of a multipart body, which `requestBodyOf` deliberately does not return. */
				const parameterBody = requestBodyParameterOf(operation);
				/**
				 * Headers are part of the input too.
				 *
				 * A signed request's `x-signature` and `x-timestamp` headers are not metadata beside the
				 * payload, they are arguments to the verification. Leaving them out of the wire type would
				 * describe an input the application cannot act on.
				 */
				const extraProperties = publishedParametersOf(operation)
					.filter(
						(parameter) =>
							parameter.type === "path" ||
							parameter.type === "query" ||
							parameter.type === "header" ||
							// The second half of the same omission: a validator with no matching type.
							parameter.type === "cookie",
					)
					/**
					 * Named as the WIRE names it, which is what the emitted validator keys on.
					 * `@header("x-thing") thing: string` is `"x-thing"` in `schemas.gen.ts`, so it has to be
					 * `"x-thing"` here too: a consumer checking its handlers against these types otherwise
					 * fails to typecheck against a server that is correct.
					 */
					// One value per name and location, as the document publishes the first declaration.
					.filter(
						(parameter, index, all) =>
							all.findIndex((other) => sameWireName(other, parameter)) === index,
					)
					.map((parameter) => ({
						key: parameter.name,
						// At the visibility its shared component is published at - see `parameterVisibilityOf`.
						// Refused as `never`, as its validator is - a header case collision, or a `@useRef`.
						line:
							headerCaseCollisionOf(program, operation, parameter) ||
							externalReferenceOf(parameter.param) !== undefined
								? `${objectKey(parameter.name)}${parameter.param.optional ? "?" : ""}: never;`
								: withVisibility(
										parameterVisibilityOf(parameter.param) ?? currentVisibility(),
										() => registry.expressionForProperty(parameter.param, parameter.name),
									),
					}));
				const fileContentType = fileContentTypeOf(operation);
				if (fileContentType !== undefined) {
					extraProperties.push({
						key: "Content-Type",
						line: `${objectKey("Content-Type")}: ${registry.expressionFor(fileContentType.type)};`,
					});
				}
				/**
				 * **A key two parameters share is written once per declaration, each in its own part**,
				 * so the intersection types it as both - what the validators beside it accept - where two
				 * members of one object literal do not compile (TS2300). `shared-input-key` reports it.
				 */
				const repeated = extraProperties.filter((property, index) =>
					extraProperties.slice(0, index).some((earlier) => earlier.key === property.key),
				);
				const distinct = extraProperties.filter((property) => !repeated.includes(property));
				const parts: string[] = [];
				let streamsBody = false;
				let bodyRef: string | undefined;
				if (placement.rawBodyProperty !== undefined) {
					/**
					 * **A binary body is the unread stream, and is spelled as one without naming
					 * `ReadableStream`.** The server hands it over unread, so a backend it is forwarded to
					 * receives a stream; a contract saying `ArrayBuffer` would make a server read a whole
					 * upload into memory to satisfy it. See `BYTE_STREAM`. A `bytes` body under a JSON type
					 * is the text a signature covers, and arrives as a string.
					 */
					streamsBody = placement.rawBodyBinary;
					parts.push(
						`{\n\t${objectKey(placement.rawBodyProperty)}: ${streamsBody ? "ByteStream | null" : "string"};\n}`,
					);
					/**
					 * **The model a body nothing parses names is still declared**, as the document declares
					 * it, though the input is the text or the bytes that arrived, so an import of it keeps
					 * working when the body is raw.
					 */
					if (body !== undefined && declaresComponent(body)) {
						withMetadataAnnotationsIgnored(ignoresMetadata(parameterBody), () =>
							registry.expressionFor(body),
						);
					}
				} else {
					const expression =
						parameterBody?.bodyKind === "multipart"
							? multipartTsOf(program, parameterBody, registry)
							: body === undefined
								? undefined
								: withMetadataAnnotationsIgnored(ignoresMetadata(parameterBody), () =>
										registry.expressionFor(body, true),
									);
					if (parameterBody?.bodyKind !== "multipart") bodyRef = expression;
					if (expression !== undefined) {
						parts.push(
							placement.bodyProperty === undefined
								? expression
								: `{\n\t${objectKey(placement.bodyProperty)}${placement.optionalBody ? "?" : ""}: ${expression.replaceAll("\n", "\n\t")};\n}`,
						);
					}
				}
				if (distinct.length > 0) {
					parts.push(`{\n${distinct.map(({ line }) => `\t${line}`).join("\n")}\n}`);
				}
				for (const { line } of repeated) parts.push(`{\n\t${line}\n}`);
				entries.push({
					operationId: operationIdOf(program, operation.operation),
					bodyRef,
					input:
						parts.length === 0
							? "globalThis.Record<string, never>"
							: `Simplify<${parts.join(" & ")}>`,
					streamsBody,
				});
			}),
		);
	}
	return entries;
}

function collectResponseTypes(
	program: Program,
	registry: TypeRegistry,
	service: HttpService,
): ResponseTypeEntry[] {
	const entries: ResponseTypeEntry[] = [];
	/**
	 * **Pinned to `Read` explicitly, rather than inheriting whatever the caller last set.**
	 *
	 * A response is the canonical projection whatever verb produced it, and the same rule is stated
	 * for the route walk: resolving responses under the ambient REQUEST visibility declared six
	 * components under the wrong suffix. Saying it here rather than relying on the default is what
	 * makes that impossible from either direction.
	 */
	withVisibility(Visibility.Read, () => {
		for (const operation of service.operations) {
			/**
			 * **The same responses, and the same members, the server emitters render.** This walk used
			 * to ask for the lowest success status and its body, so an operation answering `200 Thing`
			 * or `201 Other` published `Thing`, one answering `200 Thing` or `204` published `Thing`,
			 * and one answering only `204` was absent - while the runtime beside it carried every arm.
			 */
			const responses = inPrecedenceOrder(resolvedResponsesOf(program, operation));
			const hasBody = (response: ResolvedResponse): boolean => response.body !== undefined;
			let streams = false;
			const bodyRefs: string[] = [];
			/**
			 * **What a producer SUPPLIES for a body, which is what the server emitters accept for it.** A
			 * stream or a raw binary body is handed over as bytes and never parsed, so it is spelled as
			 * bytes - `ByteStream` rather than the platform stream, for the same reason as a request body.
			 * A model under a media type that is not JSON is what the producer serialised: text under a
			 * textual media type, bytes under any other. Everything else is the producer's view of the
			 * contract type.
			 */
			const bodyOf = (member: ResultMember<ResolvedResponse>): string | undefined => {
				// A model a body served unvalidated names is declared all the same, as the request side
				// declares one under a media type nothing parses: the document declares it either way.
				if (
					member.unvalidated &&
					member.response.body !== undefined &&
					declaresComponent(member.response.body)
				) {
					const declared = member.response.body;
					withMetadataAnnotationsIgnored(member.response.ignoresMetadata, () =>
						registry.expressionFor(declared),
					);
				}
				switch (member.serving) {
					case "none":
						return undefined;
					case "stream":
						streams = true;
						return "ByteStream";
					case "binary":
						streams = true;
						return "ByteStream | Uint8Array<ArrayBuffer> | ArrayBuffer";
					case "unvalidated":
						return "string";
					default: {
						const declared = member.response.body;
						if (declared === undefined) return undefined;
						const ref = withMetadataAnnotationsIgnored(member.response.ignoresMetadata, () =>
							registry.expressionFor(declared, true),
						);
						bodyRefs.push(ref);
						return `Produced<${ref}>`;
					}
				}
			};
			const members = resultMembersOf(responses, hasBody).map((member) => {
				const body = bodyOf(member);
				const codes = statusCodesOf(member.response, responses, hasBody);
				const fields = [`readonly status: ${codes.length === 0 ? "never" : codes.join(" | ")}`];
				if (member.choosesMediaType && member.mediaType !== undefined) {
					fields.push(`readonly contentType: ${mediaTypeTypeOf(member.mediaType)}`);
				}
				fields.push(body === undefined ? "readonly body?: undefined" : `readonly body: ${body}`);
				const headers = member.response.headers;
				if (headers.length > 0) {
					/**
					 * Keyed by the WIRE name, as the document publishes it. `headers` is optional only when
					 * every header in it is, and an optional header admits an explicit `undefined`, because
					 * a server drops one before it checks and sends the rest.
					 */
					const every = headers.every(({ property }) => property.optional);
					const rendered = headers
						.map(({ name, property }) =>
							property.optional
								? `readonly ${objectKey(name)}?: ${headerTypeOf(program, property)} | undefined`
								: `readonly ${objectKey(name)}: ${headerTypeOf(program, property)}`,
						)
						.join("; ");
					fields.push(`readonly headers${every ? "?" : ""}: { ${rendered} }`);
				}
				return { member, body, text: `{ ${fields.join("; ")} }` };
			});
			/**
			 * A success is a `2xx` or `3xx` outcome, exact or ranged, as {@link successStatusesOf} holds.
			 * `default` is not one: it is every status nothing else declares, which is mostly failures.
			 */
			const outputs = [
				...new Set(
					members
						.filter(({ member }) => isSuccessStatus(member.response.status))
						.map(({ body }) => body ?? "undefined"),
				),
			];
			entries.push({
				operationId: operationIdOf(program, operation.operation),
				output: outputs.length === 0 ? "never" : outputs.join(" | "),
				result: members.map(({ text }) => text),
				streams,
				bodyRefs,
			});
		}
	});
	return entries;
}

/** A `2xx` or `3xx` status, exact or as a range: an outcome a handler returns rather than a failure. */
function isSuccessStatus(status: StatusKey): boolean {
	if (typeof status === "number") return status >= 200 && status < 400;
	return status === "2XX" || status === "3XX";
}

/**
 * **A stream of bytes, spelled as the reader every stream has rather than as `ReadableStream`.**
 *
 * The server hands a binary request body over unread, so the contract has to say "stream" - a
 * contract saying `ArrayBuffer` would make a server read a whole upload into memory just to satisfy
 * a backend's type. But `requests.gen.ts` is framework-free, and a contracts package compiled under
 * `lib: ["ES2024"]` and no `types` cannot name `ReadableStream` at all (`TS2304`); only lib.dom,
 * lib.webworker, `@cloudflare/workers-types` and `@types/node` declare it.
 *
 * **This is the part of a stream every one of those declares, and nothing else.** Measured: a platform
 * `ReadableStream<Uint8Array> | null` is assignable to it under the default libs, lib.dom,
 * lib.webworker, workers-types and `@types/node`, on TypeScript 5.9.3 and 7.0.2, while an
 * `ArrayBuffer` is refused. `AsyncIterable<Uint8Array>`, the obvious alternative, is NOT satisfied
 * by lib.dom's stream on TypeScript 5.9 unless `dom.asynciterable` is also listed - which the usual
 * `["ES2020", "DOM", "DOM.Iterable"]` does not.
 *
 * The same precedent as a multipart file part: a type only an ambient library declares is spelled
 * structurally, so the emitted output compiles wherever it lands.
 */
const BYTE_STREAM = `
/**
 * A stream of bytes, as every platform's \`ReadableStream<Uint8Array>\` satisfies it - spelled
 * structurally so this file needs no DOM or runtime library to name it.
 */
export interface ByteStream {
	getReader(): {
		read(): globalThis.Promise<{ readonly done: boolean; readonly value?: Uint8Array | undefined }>;
		releaseLock(): void;
		cancel?(reason?: unknown): globalThis.Promise<void>;
	};
}
`;

/**
 * `requests.gen.ts` - the shape both sides are checked against.
 *
 * Plain TypeScript with no imports at all, so the contract types stay framework-free and a layering
 * rule banning a validation library from the rest of the codebase is untouched. `wire-contract.gen.ts`
 * asserts the emitted Zod infers exactly this; a consumer asserts its own code produces it. Neither
 * imports the other, and a disagreement that would otherwise answer 400 on every request becomes a
 * typecheck failure.
 */
function renderRequestTypes(
	entries: readonly RequestTypeEntry[],
	responses: readonly ResponseTypeEntry[],
	registry: TypeRegistry,
): string {
	const declarations = registry.declarations().map((declaration) => {
		/**
		 * **A vocabulary alias is exported like any other declaration.**
		 *
		 * It used to stay module-local, on the stated ground that "the vocabularies artefact already
		 * exports these names as runtime tuples, and exporting both collides on every one". That was
		 * true of a shape this emitter no longer produces: `vocabularies.gen.ts` has exactly one
		 * top-level export, `SPEC_VOCABULARIES`, and the enum names are KEYS inside it - see the
		 * docblock on `renderVocabularies`, which records why the keyed form replaced individually
		 * named tuples. There is nothing left to collide with.
		 *
		 * The stale rationale was load-bearing: `wire-contract.gen.ts` names `Contracts.<EnumName>`
		 * for an enum used as a request body, and a barrel cannot re-export a declaration that is not
		 * exported. So that file did not compile for any such spec. `TS2694`, found the first time
		 * anything compiled the conformance corpus rather than reading it.
		 */
		if (declaration.isVocabulary)
			return `\nexport type ${declaration.name} = ${declaration.source};\n`;
		return declaration.isObject
			? `\nexport interface ${declaration.name} ${declaration.source}\n`
			: `\nexport type ${declaration.name} = ${declaration.source};\n`;
	});

	const responseLookup = responses
		.map(
			(entry) =>
				`\t/** Every success body \`${commentSafe(entry.operationId)}\` declares. */\n\t${objectKey(entry.operationId)}: ${entry.output};`,
		)
		.join("\n");

	/**
	 * **One member per declared response and media type, each pairing a status with its own body.**
	 * The union a server emitter's handlers return, stated with nothing to import: a backend typed by
	 * it returns `WireResults[op]`, and a handler can hand it straight on.
	 */
	const resultLookup = responses
		.map(
			(entry) =>
				`\t/** Every response \`${commentSafe(entry.operationId)}\` declares. */\n\t${objectKey(entry.operationId)}:${entry.result.length === 0 ? " never" : entry.result.map((member) => `\n\t\t| ${member}`).join("")};`,
		)
		.join("\n");

	/**
	 * **Keyed by operation id, and the only name an operation's input has.**
	 *
	 * Each input used to be declared a second time as an alias, `CreateUserInput` for `createUser`,
	 * and this lookup referenced the aliases. That is a name a spec may well give its own request
	 * model, so the two declarations collided (`TS2300`) and `requests.gen.ts` did not
	 * compile for an operation as ordinary as `createUser(@body body: CreateUserInput)`. A type
	 * exported under a name this emitter invents is a name a spec author can already be using.
	 * `WireInputs["createUser"]` is the same type, and nothing a spec declares can collide with it.
	 */
	const lookup = entries
		.map(
			(entry) =>
				`\t/** The input for \`${commentSafe(entry.operationId)}\`, as its handler receives it. */\n\t${objectKey(entry.operationId)}: ${entry.input.replaceAll("\n", "\n\t")};`,
		)
		.join("\n");

	/**
	 * **Emitted only where an operation has something to flatten.**
	 *
	 * A generated file has to pass the lint of whatever project it lands in, and `noUnusedLocals`
	 * makes an unused type declaration an error. A service whose operations take no input at all -
	 * two parameterless `GET`s, such as a health check - got this declaration and no use of it, so
	 * `requests.gen.ts` did not compile.
	 * `TS6196: 'Simplify' is declared but never used.` Third of its kind, after the unconditional
	 * `zValidator` and `z` imports.
	 *
	 * Decided from the inputs actually rendered rather than by searching the output for the name.
	 */
	const simplifyHelper = !entries.some((entry) => entry.input.startsWith("Simplify<"))
		? ""
		: `/**
 * Flattens an intersection into a single object type.
 *
 * Without it, \`Body & { id: string }\` and the equivalent flat object are structurally the
 * same but are NOT equal under the \`Equals<>\` conditional-type trick - so the assertions that pair
 * this file with the emitted Zod would fail on correct code.
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};
`;

	return `${generatedBanner()}${simplifyHelper}
/**
 * The same shape, tolerant of \`readonly\`.
 *
 * A producer's result is asserted assignable to its published shape, and a codebase commonly declares
 * views with \`readonly\` properties and \`readonly T[]\` arrays - neither of which is assignable to a
 * mutable one. Mutability is not a fact about a wire shape: it says nothing about what a caller
 * receives. Making the TARGET readonly accepts both, which is the permissive direction; the reverse
 * would reject every view a producer actually returns.
 *
 * No branch for functions, deliberately: the wire vocabulary is primitives, objects and arrays, so
 * a call signature cannot appear here. Mapping one would yield \`{}\`, so the day something does
 * carry a method - a narrowed multipart file part is the near miss - this needs one.
 *
 * **Exported, so a NAMED type can be written against it.** A codebase whose layers hand back
 * \`readonly T[]\` needs the producer view of its own types, not only of \`WireOutputs\`, and
 * declared locally it could not be named.
 */
export type Produced<T> = T extends readonly unknown[]
	? // Mapped over the list itself, so a tuple keeps its positions: \`[A?, ...unknown[]]\`.
		{ readonly [K in keyof T]: Produced<T[K]> }
	: T extends object
		? { readonly [K in keyof T]: Produced<T[K]> }
		: T;
${entries.some((entry) => entry.streamsBody) || responses.some((entry) => entry.streams) ? BYTE_STREAM : ""}${declarations.join("")}
/**
 * Every operation's input, keyed by operation id: what its handler receives, and what a caller of a
 * backend typed by it hands over. An operation that takes nothing is \`Record<string, never>\`.
 */
export interface WireInputs {
${lookup}
}

/**
 * Every operation's success bodies, keyed by operation id: the body of each \`2xx\` and \`3xx\` response it
 * declares, \`undefined\` for one with no body, and \`never\` where it declares no success at all. Which
 * status goes with which body is \`WireResults\`.
 *
 * **A floor, not an equality.** These shapes are permissive: a caller pins the fields it depends
 * on and lets a richer view through, so a producer's result must CONTAIN what the document promises
 * and may contain more. This is what makes a published response checkable at all: without it, a
 * route can advertise a field it never returns and nothing anywhere can see it.
 */
export interface WireOutputs {
${responseLookup}
}

/**
 * Every operation's result, keyed by operation id: one member per response it declares, each pairing
 * a status with that status's body and headers. A status no response declares does not compile, and
 * a \`4XX\` or \`default\` response is the codes it stands for, written out.
 */
export interface WireResults {
${resultLookup}
}
`;
}

/**
 * The validator's half of the wire contract: the emitted Zod must infer **exactly** the shared type.
 *
 * Two artefacts describe one contract - the runtime validator and the framework-free type a codebase
 * passes around - and a shared declaration compared against only one of them lets the other drift
 * into it unnoticed. This asserts the validator *produces* the shared shape; a consumer that also
 * asserts its own code *accepts* that shape has both directions pinned.
 *
 * This is also the only thing that catches the emitter disagreeing with **itself**. `zod.ts` and
 * `types.ts` walk the same TypeSpec twice, once to Zod and once to TypeScript, and a construct one
 * handles differently from the other produces two artefacts that describe different shapes while
 * both look right in isolation. That happened during this emitter's first run: a vocabulary in a
 * query-parameter position was inlined by one walk and referenced by the other.
 *
 * **`z.input`, not `z.infer`, and the difference is the whole caller-side question.** `z.infer` is
 * the OUTPUT type - what a handler receives, after `.default(...)` has fired. These contract types
 * are the floor a PRODUCER supplies, and for a request the producer is the caller, who has not run
 * the validator. `z.input` is what the validator ACCEPTS, which is what a request contract states
 * and what the document's `required` list says. Measured on zod 4.4.3: `.default()` is the only
 * construct this emitter emits where the two differ - `.optional()`, `.nullable()` and every
 * constraint infer identically on both sides.
 *
 * Once `default-on-required-property` has removed the incoherent spelling, `z.input` and the
 * document's `required` list agree property for property, so this assertion cross-checks that rule
 * rather than merely restating one side of it.
 *
 * **One measured exception, which does not reach here.** `.refine()` with a type predicate narrows
 * the OUTPUT only - zod types it `this & ZodType<R, core.input<this>>` - so `z.input` of a
 * `HttpPart<File>` part is `unknown` where `z.infer` is the narrowed file shape. A multipart body's
 * contract type is an inline object literal rather than a named declaration, so it is never in the
 * paired set below; if that ever changes, this is the pairing that breaks first.
 *
 * `Equals` here, not assignability: the two describe one shape, and a property present on one side
 * and absent from the other is exactly the drift this exists to catch.
 */
function renderWireAssertions(
	schemas: SchemaRegistry,
	types: TypeRegistry,
	entries: readonly RequestTypeEntry[],
	responses: readonly ResponseTypeEntry[],
	contractsPackage: string | undefined,
): string | undefined {
	// The assertions pair the emitted Zod against the request TYPES, which live in the contracts
	// package. With no package named there is nothing to import them from and nothing to pair - the
	// types are still written to `contracts-output-dir`, they simply have no shared specifier yet.
	if (contractsPackage === undefined) return undefined;
	/**
	 * **Every model a body names, the responses' as well as the requests'.** This paired request
	 * bodies only, so a model that is only ever SENT was compared with nothing; that was harmless
	 * while the contract types described a single success body and nothing consumed it, and is not now
	 * that `WireResults` states every response a backend returns.
	 */
	const bodyModels = new Set([
		...entries.map((entry) => entry.bodyRef).filter((ref): ref is string => ref !== undefined),
		...responses.flatMap((entry) => entry.bodyRefs),
	]);
	const paired: { name: string; identifier: string }[] = [];
	for (const declaration of types.declarations()) {
		if (!bodyModels.has(declaration.name)) continue;
		const schema = schemas
			.declarations()
			.find((candidate) => candidate.typeName === declaration.name);
		if (schema === undefined) continue;
		paired.push({ name: declaration.name, identifier: schema.identifier });
	}

	if (paired.length === 0) return undefined;

	const assertions = paired.map(
		(pair) =>
			`export type Assert${pair.name} = MustHold<Identical<Declared<z.input<typeof ${pair.identifier}>>, Flat<Contracts.${pair.name}>>>;`,
	);

	return `${generatedBanner()}
import type { z } from "zod";
import type * as Contracts from "${contractsPackage}";
import type {
${paired.map((pair) => `\t${pair.identifier},`).join("\n")}
} from "./schemas.gen.js";

/**
 * Exact structural equality. The naive \`A extends B ? B extends A\` form reports two object types
 * equal when one has an optional property the other lacks, which is the whole class of drift this
 * exists to catch; the identity-function comparison does not.
 */
type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
	? true
	: ["the emitted validator and the shared wire type describe different shapes"];

/**
 * A shape with its index signatures removed, at every depth.
 *
 * **The two sides of this contract differ on exactly one axis, deliberately.** For an open model the
 * validator's output carries \`[key: string]: unknown\`, because a loose parse really does pass
 * unknown keys through. The shared wire type does not, because it is a FLOOR - the properties a
 * producer must supply - and an index signature there is an obligation on the producer rather than a
 * description of the payload. TypeScript gives an interface no implicit index signature, so carrying
 * it made the published shape unsatisfiable by most domain types.
 *
 * So this comparison is over DECLARED PROPERTIES, the only claim both sides make. **That the
 * validator is open wherever the document is open has not stopped being checked** - it is asserted
 * directly by the emitter's own suite now, instead of falling out of this comparison as a side
 * effect. Every other kind of drift still fails here exactly as before.
 *
 * Applied to the INFERRED side only. If the shared type ever grew an index signature of its own that
 * is a real disagreement, and this still catches it.
 *
 * Deep, because openness recurs: a nested open model puts one at every level, which is why a single
 * spread never repaired the shape it was supposed to repair.
 *
 * **An index signature arrives two ways and only one of them is openness.** A model spreading
 * \`...Record<unknown>\` gains one because its validator is loose - a fact about the MODEL, which the
 * contract type does not state, so it is stripped. A property declared \`Record<unknown>\` gains one
 * because that IS its type, stated identically in both artefacts, and stripping it destroys the
 * property: \`Declared<Record<string, unknown>>\` became \`{}\`, and any spec with a dictionary
 * property emitted an assertion that does not compile.
 *
 * The two are told apart the same way \`types.ts\` already tells them apart: **a string indexer means
 * "dictionary" only when there are no declared properties beside it.** So the index signature is
 * dropped from a shape that has other keys, and kept - with its value type still mapped - from one
 * that does not.
 */
type DeclaredKeyOf<T> = keyof {
	[K in keyof T as string extends K
		? never
		: number extends K
			? never
			: symbol extends K
				? never
				: K]: 0;
};

type Declared<T> = T extends (...args: never[]) => unknown
	? T
	: T extends readonly unknown[]
		? // Mapped over the list itself: a tuple keeps its positions, and \`readonly\` is kept as it is.
			{ [K in keyof T]: Declared<T[K]> }
		: T extends object
			? [DeclaredKeyOf<T>] extends [never]
				? [T[keyof T]] extends [never]
					? // **An indexer whose VALUE type is \`never\` admits no property, so it is an EMPTY
						// OBJECT rather than a dictionary.** Zod spells an empty object that way:
						// \`z.strictObject({})\` infers \`Record<string, never>\` under Zod 4, while this
						// walk emits \`{}\` for the same model. The two describe one shape and compared
						// unequal, so \`wire-contract.gen.ts\` did not compile for any spec declaring an
						// empty model. Normalising both to \`{}\` is what makes them agree, and it cannot
						// equate a real dictionary with an empty object: a dictionary whose values are
						// \`never\` accepts nothing either.
						{}
					: // A shape with no declared keys is a dictionary: its index signature is kept and
						// its value type mapped.
						{ [K in keyof T]: Declared<T[K]> }
				: {
						[K in keyof T as string extends K
							? never
							: number extends K
								? never
								: symbol extends K
									? never
									: K]: Declared<T[K]>;
					}
			: T;

/**
 * **The contract type with its intersections written out**, as \`Declared\` writes out the validator's:
 * \`(A) & (Inner)\` - a redeclaration merged with a \`@oneOf\` union it cannot be merged into key by key
 * - and the one object type a mapping makes of it are one shape, which the identity check below tells
 * apart by spelling. Mapped and nothing dropped, so an index signature the contract states is still
 * compared.
 */
type Flat<T> = T extends (...args: never[]) => unknown
	? T
	: T extends object
		? [keyof T] extends [never]
			? // **Every object with no key is the one \`{}\`**, as \`Declared\` writes an empty object: an
				// empty interface beside an empty literal, \`M1 | {}\`, is otherwise two members where
				// the validator's side is one.
				{}
			: { [K in keyof T]: Flat<T[K]> }
		: T;

/**
 * **The constraint is what fails the build.** \`Identical<A, B> & true\` merely produces an odd
 * type when the two disagree, and a type alias to an odd type compiles fine - an assertion that
 * asserts nothing. Only a constraint violation is an error.
 */
type MustHold<T extends true> = T;

${assertions.join("\n")}
`;
}

/**
 * `vocabularies.gen.ts` - every vocabulary the surface reaches, as runtime tuples.
 *
 * Keyed by enum name rather than emitted as individually-named tuples, because the constant names a
 * consumer wants are English plurals and some of them are irregular. An emitter that pluralises is an
 * emitter that will one day invent `CATEGORYS` and silently create a second constant beside the real
 * one. So the emitter states the fact and the consumer owns the naming.
 */
function renderVocabularies(vocabularies: ReadonlyMap<string, readonly string[]>): string {
	const entries = [...vocabularies.entries()]
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([name, values]) => `\t${name}: [${values.map((v) => literal(v)).join(", ")}],`);
	return `${generatedBanner()}
/**
 * The spec's vocabularies - every enum the surface reaches, and what each one contains.
 *
 * \`as const\` so each is a readonly tuple of literals - the type every consumer derives with
 * \`(typeof X)[number]\` keeps working unchanged.
 */
export const SPEC_VOCABULARIES = {
${entries.join("\n")}
} as const;
`;
}

/**
 * One `@service`, emitted - and everything a server emitter needs to render a router over it.
 *
 * **This is the shared seam, and it is deliberately narrow.** It carries no `SchemaRegistry`, no
 * import collector, no error schema and no vocabulary map, because measurement said a server
 * generator reads none of them: the registry is never touched once the names are minted, the external
 * imports serve the very declarations that now live in `schemas.gen.ts`, the error schema fed a route
 * table that no longer exists, and the vocabularies feed this library's own renderer. The smallest
 * surface that works is the one to freeze; anything else is added when something demonstrates a need
 * for it, with the reason recorded.
 */
export interface EmittedService {
	readonly service: HttpService;
	readonly routes: readonly EmittedRoute[];
	/** The identifiers every per-operation validator was declared under, keyed by operation id. */
	readonly schemaNames: ReadonlyMap<string, RouteSchemaNames>;
	/**
	 * **The identifier each declared type's validator is exported under in `schemas.gen.ts`**, keyed
	 * by the type: a model, union or enum the document publishes as a component of its own. A scalar
	 * is validated inline wherever it is used and has no entry.
	 *
	 * **Keyed by the types this service was emitted from**, which are the ones `operations` holds: a
	 * walk from an operation's response bodies, through each base's `derivedModels`, reaches the keys
	 * themselves. For a versioned service those are the types projected to its latest version, not
	 * the types as declared, which hold every version at once.
	 *
	 * **A body is keyed by the model it is, its effective payload type.** Where visibility reshapes a
	 * model, `@typespec/http` hands its body over as a copy - `Widget` returned beside a create-only
	 * property is `{ ...Widget }` - which is not a key and has no `derivedModels`. openapi3 resolves it
	 * to `Widget` with `getEffectivePayloadType`, and so does a lookup:
	 * `createMetadataInfo(program, { canonicalVisibility: Visibility.Read })
	 * .getEffectivePayloadType(body.type, Visibility.Read)`.
	 *
	 * **The declaration under the type's own component name**, which is the one a response reads
	 * wherever a response reads the type: `Widget` -> `widgetSchema`, beside a create view
	 * `widgetCreateSchema` that is not in this map. `@friendlyName` names it and a reserved word takes
	 * the module's `_`, as the module declares it: `@friendlyName("Canine") model Hound` ->
	 * `canineSchema`, `` model `default` `` -> `default_Schema`. A multipart body's model is here,
	 * validated as the form the document publishes. A type the document publishes only under views of
	 * it, sent in create and update bodies and never returned, has none.
	 *
	 * **Every subtype of a discriminated base is here**, nested bases included and whether or not an
	 * operation names it, so a wrapping emitter can tell which subtype a value is by the subtype's
	 * own validator: the base's parsed output does not say which arm of its dispatch matched.
	 *
	 * **A declaration that validates nothing has no entry** - `duplicate-declaration`,
	 * `split-visibility` and every other refusal of a whole type - so a lookup answers `undefined`
	 * rather than a validator that refuses every value.
	 *
	 * Published so that an emitter building on this one imports a declared type's validator by name
	 * rather than agreeing with this package about how the name is spelled.
	 */
	readonly typeSchemaNames: ReadonlyMap<Type, string>;
	/**
	 * **The operation each route was collected from, keyed by operation id**, so a wrapping emitter
	 * reading its doc comment, tags or diagnostic target reads the right one. Verb and path do not
	 * identify an operation: `@sharedRoute` puts several on one, and a lookup by them answers the
	 * same operation for each - its description became every member's, and its tags selected them.
	 */
	readonly operations: ReadonlyMap<string, HttpOperation>;
	/** Where this service's artefacts were written - a server emitter writes its own beside them. */
	readonly outputDir: string;
	/** Already resolved through the per-service overrides, so a caller re-reads nothing. */
	readonly options: ResolvedServiceOptions;
}

/** The options for one service, with every per-service override already applied. */
export interface ResolvedServiceOptions {
	readonly contractsOutputDir: string | undefined;
	readonly contractsPackage: string | undefined;
	readonly sealObjectSchemas: boolean;
	/** Whether every emitted validator is wrapped in `z.compile()`. See the option's own docblock. */
	readonly compileSchemas: boolean;
	readonly keyVocabularies: readonly string[];
	/** The command that regenerates, for the banner. `undefined` keeps the generic line. */
	readonly regenerateHint: string | undefined;
}

/**
 * Emit this library's artefacts for every `@service` in the program, and hand back what was emitted.
 *
 * **The whole orchestration lives here, once.** The nesting below is load-bearing - a walk that
 * runs outside `collectExternalImports` throws, vocabularies must be collected from what the service
 * DECLARES rather than from what the Zod walk happens to touch, and the error body has to be
 * registered inside the walk or its validator never reaches `schemas.gen.ts`. An emitter built on this
 * library calls this rather than restating it: two copies of a sequence that must agree are two
 * copies that will not, and the symptom would be a subtly different set of declarations in a file
 * whose name is the contract.
 */
/**
 * The doc tags TypeSpec understands. Anything else parses as an unknown tag, and the description
 * ends where it began. Written out rather than imported: `SyntaxKind` lives behind
 * `@typespec/compiler/ast`, whose exports map declares no `types` condition, and comparing the tag
 * NAME needs no AST import at all.
 */
const KNOWN_DOC_TAGS = new Set(["param", "template", "prop", "returns", "return", "errors"]);

/**
 * The shape this reads off a syntax node, declared structurally and deliberately small.
 *
 * `@typespec/compiler/ast` says libraries depend on the syntax tree at their own risk and outside
 * the breaking-change policy. So the surface touched is two fields, and `test/doccomment/` pins the
 * parse against the installed compiler: an upgrade that changes it turns that arm red rather than
 * silently switching the guard off.
 */
interface DocNodeLike {
	readonly tags: readonly { readonly tagName: { readonly sv: string } }[];
}

/** See the `truncated-doc-comment` docblock in `lib.ts` for why this reads the node, not the string. */
function reportTruncatedDocComments(program: Program): void {
	const check = (type: Type & { readonly name?: string | symbol }): void => {
		if (getLocationContext(program, type).type !== "project") return;
		// An `@doc(...)` decorator wins, and `@` inside a string literal truncates nothing.
		if (getDocData(program, type)?.source !== "comment") return;
		const docs = (type.node as { readonly docs?: readonly DocNodeLike[] } | undefined)?.docs;
		for (const doc of docs ?? []) {
			for (const tag of doc.tags) {
				if (KNOWN_DOC_TAGS.has(tag.tagName.sv)) continue;
				reportDiagnostic(program, {
					code: "truncated-doc-comment",
					target: type,
					format: {
						name: typeof type.name === "string" && type.name !== "" ? type.name : "(anonymous)",
						tag: tag.tagName.sv,
					},
				});
			}
		}
	};
	navigateProgram(program, {
		model: check,
		modelProperty: check,
		operation: check,
		enum: check,
		enumMember: check,
		union: check,
		unionVariant: check,
		interface: check,
		scalar: check,
	});
}

export async function emitHttpZod(context: EmitContext): Promise<readonly EmittedService[]> {
	const options = context.options as EmitterOptions;
	/**
	 * Each service already projected to the version it currently serves - see `versioning.ts`.
	 *
	 * **This used to be a bare `getAllHttpServices`, which is the UNION of every version.** A spec
	 * that removes an operation in v2 had it mounted anyway, and a spec that removed a property had it
	 * still required. Both while the document said otherwise.
	 */
	const versioning = await resolveVersioningModule();
	const snapshots = serviceSnapshots(context.program, versioning);
	/**
	 * Resolved once, here, because the walk below is synchronous and this is not. `undefined` when the
	 * optional stream libraries are not installed, which is the normal case - see `streams.ts`.
	 */
	const streamModule = await resolveStreamModule();
	const emitted: EmittedService[] = [];

	/**
	 * **One emission per `@service`, with its own registry and its own import collector.**
	 *
	 * Sharing either across services merges one surface's schemas and imports into the other's file -
	 * an unused import at best and a missing one at worst, and one surface's document carrying the
	 * other's models besides. It is invisible while there is one
	 * service, which is exactly why it is built this way before the second one lands rather than after.
	 */
	/**
	 * **Two `@service` namespaces wrote one `schemas.gen.ts`, and the second silently won.**
	 *
	 * Every service emitted into `emitterOutputDir` under the same file name, so a spec publishing
	 * two surfaces produced a single file holding whichever was walked last. Measured on two services
	 * with no per-service `output-dir`: zero diagnostics, one file, and the first service's validators
	 * absent entirely. Nothing refused, nothing warned - half the API had no validators at all.
	 *
	 * The rule is `@typespec/openapi3`'s, copied: its default output path is
	 * `openapi.{service-name-if-multiple}...`, so a name is inserted only when there is more than one
	 * service to tell apart. A single-service spec emits exactly where it always did.
	 *
	 * The directory is what carries it rather than the file name, because `EmittedService.outputDir`
	 * is already the published seam a wrapping emitter writes its own files beside. Disambiguating
	 * there means a server emitter follows without knowing this rule exists.
	 */
	const distinctServices = new Set(snapshots.map((snapshot) => snapshot.service.namespace.name));
	/** The services writing to the top-level `contracts-output-dir`: every one not naming its own. */
	const sharingContracts = [...distinctServices].filter(
		(name) => options.services?.[name]?.["contracts-output-dir"] === undefined,
	);
	/**
	 * **Every service must seal the same way, because `@typespec/openapi3` has no per-service
	 * options.**
	 *
	 * This option exists only so that two emitters answering the same question about the same models
	 * give the same answer - it is stated twice on purpose, and its own docblock says to set it to
	 * whatever openapi3 is set to. openapi3 applies ONE value to the whole program. So services that
	 * seal differently cannot both be mirrored: whichever way openapi3 is configured, at least one
	 * service publishes a document that disagrees with the validator generated beside it. Sealed here
	 * and silent there refuses a payload the document permits; the reverse publishes a strictness the
	 * runtime does not enforce.
	 *
	 * Reported once for the program rather than once per service, because the fault is the
	 * DISAGREEMENT and no single service is the wrong one.
	 */
	const sealings = new Map<string, boolean>();
	for (const snapshot of snapshots) {
		const name = snapshot.service.namespace.name;
		const perService = options.services?.[name];
		sealings.set(
			name,
			perService?.["seal-object-schemas"] ?? options["seal-object-schemas"] ?? false,
		);
	}
	if (new Set(sealings.values()).size > 1) {
		const sealed = [...sealings.entries()].filter(([, seals]) => seals).map(([name]) => name);
		const open = [...sealings.entries()].filter(([, seals]) => !seals).map(([name]) => name);
		reportDiagnostic(context.program, {
			code: "unmirrorable-seal",
			target: NoTarget,
			format: { sealed: sealed.join(", "), open: open.join(", ") },
		});
	}
	/**
	 * Once per program, before the per-service loop: a doc comment belongs to a type, not to a
	 * service, and a type reachable from two services would otherwise be named twice.
	 */
	reportTruncatedDocComments(context.program);
	for (const snapshot of snapshots) {
		beginOperationIds();
		/**
		 * **The service as it is written to files: its operations in the order the spec declares
		 * them** - see `declaration-order.ts`. `beginServiceView` reads the namespace in the checker's
		 * order, as openapi3 does, so what decides a schema's content is unchanged; this decides where
		 * each route, validator and request lands, and what a server emitter built on it iterates.
		 */
		const service = inDeclaredOperationOrder(context.program, snapshot.service);
		/**
		 * **Rendered whole before anything is written.** This service's view, its operation ids and
		 * its banner are module state, and an `await` while they are in force lets another compile in
		 * the same process run in between: the contract types were walked after `schemas.gen.ts` was
		 * written, and with three fixtures compiled at once in one suite, one walked them under
		 * another program's view - its components unsuffixed, `DerivedK` declared twice, its wire
		 * contract unable to pair a validator with its type. Written after the scope closes, nothing
		 * awaits inside it.
		 */
		const writes: { path: string; content: string }[] = [];
		// Named and written as openapi3 names and writes this service's components - see `published.ts`.
		const restoreView = beginServiceView(context.program, service.namespace);
		try {
			/**
			 * **A union that reaches itself through unions alone is refused before anything is walked,
			 * and the service emits nothing.** Every other refusal is reported and walked past, so one
			 * compile names them all; this one cannot be walked past, because every reading of it - the
			 * schema, the type, a parameter's forms - recurses without end. The rest of the service is
			 * read once the cycle is broken. See `reachesItselfThroughUnions`.
			 */
			const selfReaching = [...publishedTypes()].filter(
				(type): type is Union =>
					type.kind === "Union" &&
					type.name !== undefined &&
					reachesItselfThroughUnions(context.program, type),
			);
			for (const union of selfReaching) refuseSelfReachingUnion(context.program, union);
			if (selfReaching.length > 0) continue;
			const serviceName = service.namespace.name;
			const perService = options.services?.[serviceName];
			const outputDir =
				perService?.["output-dir"] ??
				(distinctServices.size > 1
					? resolvePath(context.emitterOutputDir, serviceName)
					: context.emitterOutputDir);
			/**
			 * **Split where two services would write one file, and nowhere else.** A shared contracts
			 * directory was written once per service to one path, so the second service's
			 * `requests.gen.ts` replaced the first's and a whole surface lost its contracts with no
			 * diagnostic. Counted over the services that WRITE there: one service falling back to the
			 * shared directory, beside others that name their own, collides with nothing, and splitting
			 * it moved contracts a project already imported. A relative `contracts-package` is resolved
			 * from each service's own `wire-contract.gen.ts`, so it names that service's contracts; a
			 * package specifier has to be set per service.
			 */
			const sharedContractsDir = options["contracts-output-dir"];
			const resolved: ResolvedServiceOptions = {
				contractsOutputDir:
					perService?.["contracts-output-dir"] ??
					(sharedContractsDir !== undefined && sharingContracts.length > 1
						? resolvePath(sharedContractsDir, serviceName)
						: sharedContractsDir),
				contractsPackage: perService?.["contracts-package"] ?? options["contracts-package"],
				sealObjectSchemas:
					perService?.["seal-object-schemas"] ?? options["seal-object-schemas"] ?? false,
				compileSchemas: perService?.["compile-schemas"] ?? options["compile-schemas"] ?? false,
				keyVocabularies: perService?.["key-vocabularies"] ?? options["key-vocabularies"] ?? [],
				regenerateHint: perService?.["regenerate-hint"] ?? options["regenerate-hint"],
			};
			beginBanner(resolved.regenerateHint);

			const registry = new SchemaRegistry(context.program);

			const {
				result: { routes },
				imports: externals,
				vocabularies,
			} = collectExternalImports(() =>
				withContractsPackage(resolved.contractsPackage, () =>
					withSealedObjects(resolved.sealObjectSchemas, () => {
						// Declarations first: a vocabulary is a fact about the contract, so it is collected from
						// what the service DECLARES rather than from what the Zod walk happens to touch. An enum
						// reachable only through an error body was silently absent otherwise.
						noteDeclaredVocabularies(
							inDeclarationOrder(context.program, service.namespace.enums.values()),
						);
						/**
						 * A closed key SET is a vocabulary too, and it cannot be an enum.
						 *
						 * TypeSpec has no key-constrained `Record`, so a model naming its permitted properties is
						 * how the document states one - and a generated type cannot be iterated, which leaves a
						 * consumer needing the set at run time with a hand-maintained copy. Naming the model in
						 * `key-vocabularies` writes the keys beside the types. A name matching nothing is
						 * reported rather than quietly emitting no tuple.
						 */
						const emittedKeyVocabularies = noteKeyVocabularies(
							context.program,
							inDeclarationOrder(context.program, service.namespace.models.values()),
							resolved.keyVocabularies,
						);
						for (const name of resolved.keyVocabularies) {
							if (emittedKeyVocabularies.includes(name)) continue;
							reportDiagnostic(context.program, {
								code: "unknown-key-vocabulary",
								target: service.namespace,
								format: { name, service: service.namespace.name },
							});
						}
						/**
						 * The error body is registered INSIDE this walk, so its validator lands in
						 * `schemas.gen.ts` alongside every other declaration. Nothing else reaches it: the Zod
						 * walk follows success bodies and parameters, so without this a runtime would have no
						 * generated schema to check the documents it sends against.
						 *
						 * **Its expression is registered and then deliberately discarded.** It used to be
						 * returned and used as a fallback for any response arm whose own body could not be
						 * resolved, which meant every catch-all answered with whichever shape `errorBodyOf` had
						 * settled on rather than the one its own response declares. Each arm resolves its own
						 * body now; registering this one only ensures it is declared.
						 */
						const errorBody = errorBodyOf(context.program, service);
						if (errorBody !== undefined) {
							withVisibility(Visibility.Read, () => registry.expressionFor(errorBody));
						}
						const routes = withStreamModule(streamModule, () =>
							collectRoutes(context.program, registry, service),
						);
						// And every type no operation reaches, as openapi3 publishes it - see `unreachedTypes`.
						withVisibility(Visibility.All, () => {
							for (const type of inDeclarationOrder(context.program, unreachedTypes())) {
								registry.expressionFor(type);
							}
						});
						// And every component openapi3 writes that no route names - see `publishedComponents`.
						for (const { type, at, ignore, binary } of byDeclarationOf(
							context.program,
							publishedComponents(context.program),
							(component) => component.type,
						)) {
							withVisibility(at, () =>
								withMetadataAnnotationsIgnored(ignore, () =>
									withMultipartBinary(binary, () => registry.declare(type)),
								),
							);
						}
						return { routes };
					}),
				),
			);

			/**
			 * **Named AFTER the walk and BEFORE the file is rendered.** Naming mints identifiers that
			 * `schemas.gen.ts` must declare, so it has to happen while the registry is complete and before
			 * anything is written - and it has to happen HERE rather than in a server emitter, or the
			 * validators it produces never reach this package's own output.
			 */
			const { names, declarations } = nameRouteSchemas(routes, resolved.compileSchemas);

			writes.push({
				path: resolvePath(outputDir, "schemas.gen.ts"),
				content: renderSchemas(registry, externals, declarations, resolved.compileSchemas),
			});

			if (resolved.contractsOutputDir !== undefined) {
				const types = new TypeRegistry(context.program, registry.held);
				/**
				 * **Inside the same stream scope as the route walk**, because both read the same response
				 * records: outside it `streamedTypeOf` cannot see `@typespec/streams`, so an SSE body was
				 * stated as the string the document describes rather than the stream a server sends.
				 */
				/**
				 * **And inside the same sealing**, because whether a model is published at all can depend
				 * on it - a template instance extending a base openapi3 seals is refused on both sides,
				 * `sealed-base-extended` - and the two walks have to agree about that.
				 */
				const { requests, assertions } = withSealedObjects(resolved.sealObjectSchemas, () => {
					const { entries, responses } = withStreamModule(streamModule, () => ({
						entries: collectRequestTypes(context.program, types, service),
						responses: collectResponseTypes(context.program, types, service),
					}));
					withVisibility(Visibility.All, () => {
						for (const type of inDeclarationOrder(context.program, unreachedTypes())) {
							types.expressionFor(type);
						}
					});
					for (const { type, at, ignore, binary } of byDeclarationOf(
						context.program,
						publishedComponents(context.program),
						(component) => component.type,
					)) {
						withVisibility(at, () =>
							withMetadataAnnotationsIgnored(ignore, () =>
								withMultipartBinary(binary, () => types.declare(type)),
							),
						);
					}
					types.refuse(registry.refusedNames());
					return {
						requests: renderRequestTypes(entries, responses, types),
						assertions: renderWireAssertions(
							registry,
							types,
							entries,
							responses,
							resolved.contractsPackage,
						),
					};
				});
				writes.push({
					path: resolvePath(resolved.contractsOutputDir, "requests.gen.ts"),
					content: requests,
				});
				writes.push({
					path: resolvePath(resolved.contractsOutputDir, "vocabularies.gen.ts"),
					content: renderVocabularies(vocabularies),
				});
				if (assertions !== undefined) {
					writes.push({
						path: resolvePath(outputDir, "wire-contract.gen.ts"),
						content: assertions,
					});
				}
			}

			// Still inside this service's id scope, so each operation resolves to the id its route carries.
			const operations = new Map(
				service.operations.map((operation) => [
					operationIdOf(context.program, operation.operation),
					operation,
				]),
			);
			emitted.push({
				service,
				routes,
				schemaNames: names,
				typeSchemaNames: registry.typeIdentifiers(),
				operations,
				outputDir,
				options: resolved,
			});
		} finally {
			restoreView();
		}
		for (const write of writes) await emitFile(context.program, write);
	}
	return emitted;
}
