import { CONTENTLESS_STATUS_CODES, STATUS_CODES } from "./statuses.js";

/**
 * **What a result is made of: one member per declared response and media type, and the codes each
 * one answers with.** One derivation, read by every artefact that states a result.
 *
 * `typespec-hono` types a handler's return as a union of these members, `typespec-http-mcp` types a
 * tool's the same way, and `requests.gen.ts` states the same union for a backend that has no
 * framework to import. All three used to hold their own copy of these rules, and three copies of
 * rules that must agree are three that will not: a status one of them could see and another could
 * not is how `WireOutputs` came to publish one success body for an operation answering two.
 */

/**
 * A status as the DOCUMENT keys it: an exact code, a `4XX` bucket, or the catch-all.
 *
 * `"default"` is kept as itself rather than mapped to a number. The document means "any status not
 * listed above", and inventing one would be answering a question the contract left open.
 */
export type StatusKey = number | "default" | `${1 | 2 | 3 | 4 | 5}XX`;

/**
 * The facts about one declared response that decide how its result is shaped.
 *
 * Structural, so both an emitted response (`EmittedResponse`, whose body is a Zod expression) and a
 * resolved one (whose body is a TypeSpec type) satisfy it; the caller says which ones carry a body.
 */
export interface ResponseFacts {
	readonly status: StatusKey;
	readonly contentTypes: readonly string[];
	readonly binary: boolean;
	readonly streamed: boolean;
	readonly textual: boolean;
}

/** How a member's body is served, which decides both its type and the call that serves it. */
export type BodyServing = "none" | "stream" | "binary" | "json" | "text" | "unvalidated";

/**
 * One member of an operation's result: one response, served as one media type.
 *
 * **A status offering several media types is several members**, because the body differs by media
 * type: the Swagger Petstore answers `getPetById` with a `Pet` as `application/json` and with text as
 * `application/xml`. One member with a union body could not say which body goes with which type.
 */
export interface ResultMember<R extends ResponseFacts> {
	readonly response: R;
	/** The response's position in the list it came from, so a caller can find what it names it by. */
	readonly index: number;
	/** The media type served, or `undefined` where the response has no body. */
	readonly mediaType: string | undefined;
	/**
	 * Whether the result names the media type: the status offers more than one, or the document names
	 * a range such as `image/*`, which is not a type a response can be sent as.
	 */
	readonly choosesMediaType: boolean;
	readonly serving: BodyServing;
	/**
	 * **The document declares a schema for this body that nothing checks it against**: a model under a
	 * media type that is not JSON, which the handler supplies as text (`"unvalidated"`) or, under a
	 * type that is not text, as bytes (`"binary"`). A `bytes` or `Http.File` body declares nothing to
	 * check, so it is not this.
	 */
	readonly unvalidated: boolean;
}

/**
 * **A media type's essence: `type/subtype`, lowercased, with no parameters** (RFC 9110 section
 * 8.3.1). Two media types are the same type exactly when their essences are equal, so every
 * comparison of a declared media type is of this. `application/json; charset=utf-8` and
 * `Application/JSON` were compared as whole strings and read as not JSON: the body became raw text,
 * and the response an unvalidated string.
 */
export function mediaTypeEssenceOf(type: string): string {
	return (type.split(";")[0] ?? "").trim().toLowerCase();
}

/** `application/json` and every `+json` suffix: the media types a body is serialised as JSON for. */
export function isJsonMediaType(type: string): boolean {
	return /^application\/(json|.*\+json)$/.test(mediaTypeEssenceOf(type));
}

/**
 * **A media type whose body is text by its registration**: the `text` top-level type (RFC 2046
 * section 4.1) and the XML media types, `application/xml` and the `+xml` suffix (RFC 7303).
 *
 * **What decides whether a body nothing parses is text or bytes.** A model declared under such a type
 * has no reader or serialisation this emitter can derive, so it is handed over as the text that
 * arrived and answered as the text the handler writes. Under any other type, such as
 * `application/octet-stream` or `application/x-protobuf`, text cannot carry it: decoded as UTF-8,
 * every byte that is not a valid sequence becomes U+FFFD, so it is bytes instead. JSON is text as
 * well, and is parsed rather than handed over, so it never reaches this question.
 */
export function isTextualMediaType(type: string): boolean {
	const essence = mediaTypeEssenceOf(type);
	return essence.startsWith("text/") || essence === "application/xml" || essence.endsWith("+xml");
}

/** A media range such as `image/*`, rather than a type a response can be sent as. */
export function isMediaRange(mediaType: string): boolean {
	return mediaTypeEssenceOf(mediaType).endsWith("/*");
}

/**
 * The type of the `contentType` a result names for a member.
 *
 * **A range is typed as the types inside it**: `image/*` is `` `image/${string}` ``, so `text/html`
 * under it does not compile, and TypeScript still narrows a literal member away from it. Only the
 * full range is `string`.
 */
export function mediaTypeTypeOf(mediaType: string): string {
	if (!isMediaRange(mediaType)) return JSON.stringify(mediaType);
	if (mediaType === "*/*") return "string";
	return `\`${mediaType.slice(0, -1)}\${string}\``;
}

/**
 * Every member an operation's responses declare, in the order the responses are listed.
 *
 * `hasBody` says which responses carry a body, because the two kinds of record spell that
 * differently - an emitted one has a schema, a resolved one has a type.
 */
export function resultMembersOf<R extends ResponseFacts>(
	responses: readonly R[],
	hasBody: (response: R) => boolean,
): ResultMember<R>[] {
	return responses.flatMap((response, index): ResultMember<R>[] => {
		if (response.contentTypes.length === 0) {
			return [
				{
					response,
					index,
					mediaType: undefined,
					choosesMediaType: false,
					serving: "none",
					unvalidated: false,
				},
			];
		}
		const choosesMediaType =
			response.contentTypes.length > 1 || response.contentTypes.some(isMediaRange);
		return response.contentTypes.map((mediaType) => {
			const serving = servingOf(response, mediaType, hasBody(response));
			return {
				response,
				index,
				mediaType,
				choosesMediaType,
				serving,
				unvalidated: serving === "unvalidated" || (serving === "binary" && !response.binary),
			};
		});
	});
}

function servingOf(response: ResponseFacts, mediaType: string, bodied: boolean): BodyServing {
	if (!bodied) return "none";
	if (response.streamed) return "stream";
	if (response.binary) return "binary";
	if (isJsonMediaType(mediaType)) return "json";
	/**
	 * **A string body under a non-JSON media type IS the text**, so it is validated and served as is.
	 * Any other body under one - a model as `application/xml` - has no serialisation this emitter can
	 * derive, so it has to come from the application and is served unvalidated: as the text it writes
	 * under a textual media type, and as bytes under any other (see {@link isTextualMediaType}).
	 */
	if (response.textual) return "text";
	return isTextualMediaType(mediaType) ? "unvalidated" : "binary";
}

/**
 * The codes a declared response answers with, written out.
 *
 * - An exact code is itself.
 * - A range is its class's codes, less every code declared exactly - OpenAPI resolves an exact code
 *   before its range, as a server does - and, where it carries a body, less the codes that cannot.
 * - `default` is every code from `2xx` to `5xx` that nothing else declares, exactly or by range,
 *   again less the contentless codes where it carries a body. `1xx` is not a result a handler
 *   returns.
 *
 * **Written out rather than as `number`**, because `number` admits `999`, and a client cannot
 * narrow a result on a status type that admits everything. Empty where nothing is left, which a
 * caller renders as `never`.
 */
export function statusCodesOf<R extends ResponseFacts>(
	response: R,
	responses: readonly R[],
	hasBody: (response: R) => boolean,
): readonly number[] {
	const { status } = response;
	if (typeof status === "number") return [status];
	const exact = new Set(
		responses.flatMap((candidate) =>
			typeof candidate.status === "number" ? [candidate.status] : [],
		),
	);
	const contentless = new Set<number>(hasBody(response) ? CONTENTLESS_STATUS_CODES : []);
	const classOf = (key: `${1 | 2 | 3 | 4 | 5}XX`): readonly number[] =>
		STATUS_CODES[Number(key.charAt(0)) as 1 | 2 | 3 | 4 | 5];
	const candidates =
		status === "default"
			? ([2, 3, 4, 5] as const).flatMap((digit) => STATUS_CODES[digit])
			: classOf(status);
	const ranged = new Set(
		status === "default"
			? responses.flatMap((candidate) =>
					typeof candidate.status === "string" && candidate.status !== "default"
						? classOf(candidate.status)
						: [],
				)
			: [],
	);
	return candidates
		.filter((code) => !exact.has(code) && !ranged.has(code) && !contentless.has(code))
		.toSorted((a, b) => a - b);
}
