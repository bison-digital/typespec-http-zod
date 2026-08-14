import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
	compileScenario,
	depthSources,
	discoverScenarios,
	GRADED_OPENAPI_VERSIONS,
	openapiDirFor,
	type CompiledScenario,
} from "./corpus.js";
import {
	describeDocumentDiscriminator,
	describeDocumentObject,
	describeZodDiscriminatedUnion,
	describeZodObject,
	namesFromModule,
	topLevelKindOfDocument,
	topLevelKindOfZod,
	isUnresolvable,
	propertySchemaOf,
	type JsonSchema,
	type RefResolver,
	type ObjectShape,
} from "./shape.js";

/**
 * **The oracle: `@typespec/openapi3`, over Microsoft's own scenario corpus.**
 *
 * Every other test in this package was written by whoever wrote the emitter, against fixtures they
 * also chose. This one is not. Both artefacts come out of ONE compile of a spec we did not write,
 * and the assertion is that they say the same thing about the same models. Where they differ, the
 * document is right by definition - it is the contract callers read, and it is produced by the
 * reference implementation.
 *
 * **"It compiled" is not evidence, and this corpus proves it on itself.** Before this suite
 * existed, `serialization/encoded-name/json` - whose scenario doc reads "Testing that you send the
 * right JSON name on the wire" - compiled clean and emitted `defaultName` where the document
 * requires `wireName`. It sat in the green column. An exit code is not an oracle; a second artefact
 * built from the same source is.
 *
 * **The baseline may only shrink.** Both directions are asserted: a divergence not in the baseline
 * fails as a regression, and a baseline entry that no longer diverges fails as stale. That second
 * arm is what stops the file becoming a place where defects go to be forgotten - fixing one makes
 * this suite red until the entry is deleted.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const baselinePath = join(here, "baseline.json");

/** `Property.JsonEncodedNameModel` -> `jsonEncodedNameModelSchema`. */
function identifierFor(component: string): string {
	// openapi3 qualifies a component with its namespace when the bare name is ambiguous; the emitter
	// names declarations from the model alone. Stripping is safe only while no two components we
	// actually emit collapse together, which `no two components claim one identifier` asserts.
	const bare = component.split(".").at(-1) ?? component;
	return `${bare.charAt(0).toLowerCase()}${bare.slice(1)}Schema`;
}

interface DocumentParameter {
	readonly name?: string;
	readonly in?: string;
	readonly required?: boolean;
	readonly schema?: JsonSchema;
	readonly $ref?: string;
}

interface DocumentResponse {
	readonly content?: Readonly<
		Record<string, { readonly schema?: JsonSchema; readonly itemSchema?: JsonSchema }>
	>;
}

interface DocumentOperation {
	readonly operationId?: string;
	readonly parameters?: readonly DocumentParameter[];
	readonly responses?: Readonly<Record<string, DocumentResponse>>;
}

interface OpenApiDocument {
	readonly paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	readonly components?: {
		readonly schemas?: Record<string, JsonSchema>;
		readonly parameters?: Record<string, DocumentParameter>;
	};
}

/** The three parameter locations this emitter mounts a validator for. `cookie` is not one. */
const PARAMETER_TARGETS = [
	{ in: "path", suffix: "Path" },
	{ in: "query", suffix: "Query" },
	{ in: "header", suffix: "Header" },
] as const;

/**
 * A location's parameters, as the object schema they collectively describe.
 *
 * **This is the whole trick, and it is why there is no second comparison engine here.** A
 * validator for `?a=1&b=2` is an object with properties `a` and `b`; so is the document's list of
 * query parameters. Reshaping one into the other lets the existing `compareShapes` ask every
 * question it already asks of a component - names, required, type, nullability, constraints - of a
 * surface it had never been pointed at.
 *
 * `undefined` when the location has no parameters, which is different from having none we can read.
 */
/**
 * Headers OpenAPI states somewhere other than `parameters`, so their absence from that list is not
 * the document declining to constrain them.
 *
 * **Excluded from the comparison, and COUNTED - never silently dropped.** `@header contentType`
 * reaches the document as the KEYS of `requestBody.content`, and `accept` as the keys of a
 * response's `content`. Reading their absence from `parameters` as "the document says nothing" is
 * reading absence from a channel that cannot report presence: the emitter validating them is right,
 * and it was this arm that was looking in one place for a fact stated in another.
 *
 * The honest consequence is that `content-type` and `accept` validators are still ungraded. That is
 * a smaller hole than the one this arm closes, and `contentHeadersSkipped` keeps it a number rather
 * than an assumption - the fix is to compare them against the `content` keys, which is B10's
 * neighbourhood.
 */
const CONTENT_NEGOTIATION_HEADERS = new Set(["content-type", "accept"]);

function parametersAsSchema(
	parameters: readonly DocumentParameter[],
	location: string,
): JsonSchema | undefined {
	const here = parameters.filter((parameter) => parameter.in === location);
	if (here.length === 0) return undefined;
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];
	for (const parameter of here) {
		if (parameter.name === undefined) continue;
		// BOTH sides must drop these, or the filter creates the disagreement it was added to avoid:
		// removing `accept` from the validator alone reported every negotiated route as having the
		// wrong property names.
		if (CONTENT_NEGOTIATION_HEADERS.has(parameter.name.toLowerCase())) continue;
		// An absent `schema` is the empty schema: the document constrains the value not at all.
		properties[parameter.name] = parameter.schema ?? {};
		if (parameter.required === true) required.push(parameter.name);
	}
	if (Object.keys(properties).length === 0) return undefined;
	return { type: "object", properties, required };
}

/** Drop the headers OpenAPI states through `content` keys, counting each so the gap stays visible. */
/**
 * The media types a `content-type` or `accept` validator accepts, read from the Zod schema directly.
 *
 * **Read from the schema rather than through the describer, deliberately.** `PropertyShape`
 * reduces a property to what BOTH artefacts can express - a kind, a nullability, a constraint set -
 * and a media type is none of those. It is a literal string the document states somewhere else
 * entirely, so comparing it needs the values themselves.
 *
 * `undefined` means unreadable, never "none": a validator whose media types cannot be recovered is a
 * position this arm must count as skipped rather than silently pass.
 */
function mediaTypesAccepted(validator: unknown, header: string): readonly string[] | undefined {
	const def = (validator as { _zod?: { def?: ZodShapeDef } } | undefined)?._zod?.def;
	/**
	 * **Looked up case-INSENSITIVELY, because the emitted key is the wire name the spec wrote.**
	 * Measured across the corpus: 84 validators carry `"Content-Type"`, capitalised. HTTP header names
	 * are case-insensitive per RFC 9110 section 5.1, so the emitter is right to keep the spec's spelling -
	 * and a reader that lower-cases its needle finds nothing and reports a clean sweep. This arm
	 * compared **zero** positions on its first run for exactly that reason, and only the floor said so.
	 */
	const key = Object.keys(def?.shape ?? {}).find((name) => name.toLowerCase() === header);
	const property = key === undefined ? undefined : def?.shape?.[key];
	if (property === undefined) return undefined;
	const literals = (node: unknown): readonly string[] | undefined => {
		// A `content-type` validator now decodes the media type out of the header before matching, so
		// the literal it compares against sits behind a `pipe`. See `throughDecode`.
		const inner = throughDecode((node as { _zod?: { def?: ZodShapeDef } } | undefined)?._zod?.def);
		if (inner === undefined) return undefined;
		// `.optional()` / `.nullable()` / `.default()` wrap the thing that carries the values.
		if (inner.innerType !== undefined) return literals(inner.innerType);
		if (inner.type === "literal") {
			return (inner.values ?? []).filter((value): value is string => typeof value === "string");
		}
		if (inner.type === "enum") {
			return Object.values(inner.entries ?? {}).filter(
				(value): value is string => typeof value === "string",
			);
		}
		if (inner.type === "union") {
			const parts = (inner.options ?? []).map(literals);
			if (parts.some((part) => part === undefined)) return undefined;
			return parts.flatMap((part) => part ?? []);
		}
		return undefined;
	};
	return literals(property);
}

interface ZodShapeDef {
	readonly type?: string;
	readonly shape?: Record<string, unknown>;
	readonly innerType?: unknown;
	readonly values?: readonly unknown[];
	readonly entries?: Record<string, unknown>;
	readonly options?: readonly unknown[];
	/**
	 * The schema a `z.preprocess` applies AFTER decoding - see {@link throughDecode}.
	 *
	 * `z.preprocess(fn, schema)` is a `pipe` in Zod 4, and `out` is where the real schema lives.
	 */
	readonly out?: unknown;
}

/**
 * Look through a wire decode to the schema the document actually published.
 *
 * **This is the SECOND describer in this file to be blinded by `z.preprocess`, and the first one
 * is recorded in the handover.** A flattened collection parameter read as required because optionality
 * sits outside the wrapper; the fix taught that walker about `pipe.out`, and this walker was never
 * told. When `content-type` validators gained a decode that strips media type parameters, this arm
 * fell from 70+ comparisons to **zero** and only its floor said so.
 *
 * The lesson is not "add `out` here": it is that a decode wrapper is now an ordinary part of what this
 * emitter produces, and every reader of emitted Zod has to see through it. Any walker added later
 * starts by calling this.
 */
function throughDecode(def: ZodShapeDef | undefined): ZodShapeDef | undefined {
	if (def?.type !== "pipe" || def.out === undefined) return def;
	const inner = (def.out as { _zod?: { def?: ZodShapeDef } })._zod?.def;
	return throughDecode(inner);
}

/**
 * The request body's schema, and whether it names a component.
 *
 * **The request body was compared by NOTHING.** The parameter arm grades `path`, `query` and
 * `header`; the response arms grade what an operation answers with. What a caller may SEND - the
 * body, the largest surface of most APIs - had no arm at all. Measured: 28 scalar or array request
 * bodies in the corpus alone, none of them compared, and the symmetry with the response side is
 * exactly what made it visible.
 */
function requestBodySchema(
	operation: DocumentOperation,
): { readonly schema: JsonSchema; readonly component: string | undefined } | undefined {
	const content = (
		operation as { requestBody?: { content?: Record<string, { schema?: unknown }> } }
	).requestBody?.content;
	for (const media of Object.values(content ?? {})) {
		const schema = media.schema;
		if (schema === undefined) continue;
		const ref = (schema as { $ref?: unknown }).$ref;
		return {
			schema: schema as JsonSchema,
			component:
				typeof ref === "string" && ref.startsWith("#/components/schemas/")
					? ref.replace("#/components/schemas/", "")
					: undefined,
		};
	}
	return undefined;
}

/** Every media type the document names for an operation's REQUEST body. */
function requestMediaTypes(operation: DocumentOperation): readonly string[] {
	const content = (operation as { requestBody?: { content?: Record<string, unknown> } }).requestBody
		?.content;
	return Object.keys(content ?? {}).toSorted();
}

/** Every media type the document names across an operation's RESPONSES. */
function responseMediaTypes(operation: DocumentOperation): readonly string[] {
	const responses = (
		operation as { responses?: Record<string, { content?: Record<string, unknown> }> }
	).responses;
	const found = new Set<string>();
	for (const response of Object.values(responses ?? {})) {
		for (const type of Object.keys(response.content ?? {})) found.add(type);
	}
	return [...found].toSorted();
}

function withoutContentHeaders(
	shape: ObjectShape | undefined,
	count: () => void,
): ObjectShape | undefined {
	if (shape === undefined) return undefined;
	const kept: Record<string, (typeof shape.properties)[string]> = {};
	for (const [name, property] of Object.entries(shape.properties)) {
		if (CONTENT_NEGOTIATION_HEADERS.has(name.toLowerCase())) count();
		else kept[name] = property;
	}
	return { openness: shape.openness, properties: kept };
}

/**
 * The per-route validator for a document operation, tolerating openapi3's merged ids.
 *
 * **A negotiated route has ONE path entry and several operations behind it**, and openapi3 names
 * it by joining their ids - `SameBody_getAvatarAsPng_SameBody_getAvatarAsJpeg`. No emitted const
 * carries that name, and looking only for an exact match reported the route as having no validator
 * at all. Every member shares the route, so every member shares its path, query and header
 * validators; the first whose id prefixes the document's serves for the comparison.
 */
function validatorFor(
	emitted: Record<string, unknown>,
	operationId: string,
	suffix: string,
): unknown {
	const exact = emitted[`${operationId}${suffix}`];
	if (exact !== undefined) return exact;
	for (const [key, value] of Object.entries(emitted)) {
		if (!key.endsWith(suffix)) continue;
		const candidate = key.slice(0, -suffix.length);
		if (candidate !== "" && operationId.startsWith(`${candidate}_`)) return value;
	}
	return undefined;
}

/** One arm of the emitted `<operationId>Responses` const - what the operation may answer with. */
interface EmittedArm {
	readonly status: number | string;
	readonly schema?: unknown;
}

/**
 * The response arms emitted for a document operation: each declared status, and its body's schema.
 *
 * **A negotiated route is SEVERAL operations behind one document entry**, so its arms are the
 * union of its members' - the same merged-id rule `validatorFor` follows, and for the same reason:
 * openapi3 names the merged entry by joining the ids, and no emitted const carries that name.
 * `merged` says whether that happened, because the STATUS set unions honestly across members while
 * the body for a given status does not: each member answers its own media type with its own shape.
 */
function responseArmsFor(
	emitted: Record<string, unknown>,
	operationId: string,
): { readonly arms: readonly EmittedArm[]; readonly merged: boolean } | undefined {
	const exact = emitted[`${operationId}Responses`];
	if (Array.isArray(exact)) return { arms: exact as EmittedArm[], merged: false };
	const parts: EmittedArm[] = [];
	for (const [key, value] of Object.entries(emitted)) {
		if (!key.endsWith("Responses") || !Array.isArray(value)) continue;
		const candidate = key.slice(0, -"Responses".length);
		if (candidate !== "" && operationId.startsWith(`${candidate}_`)) {
			parts.push(...(value as EmittedArm[]));
		}
	}
	return parts.length === 0 ? undefined : { arms: parts, merged: true };
}

/**
 * The component a response's body is a `$ref` to, or `undefined` when it does not name one.
 *
 * Only a `$ref` is read. An inline response schema is a real shape the emitter still has to get
 * right, but comparing it here would duplicate the component walk against a schema that has no
 * component to be compared as; those are counted as skips instead of guessed at.
 */
function responseComponentOf(response: DocumentResponse): string | undefined {
	for (const media of Object.values(response.content ?? {})) {
		const ref = media.schema?.$ref;
		if (typeof ref === "string" && ref.startsWith("#/components/schemas/")) {
			return ref.replace("#/components/schemas/", "");
		}
	}
	return undefined;
}

/**
 * The response's body schema when it names no component - an INLINE shape.
 *
 * **These were counted and skipped, and the count was 76.** The arm above compares by NAME, and an
 * inline schema has none, so the status-to-body mapping was graded while the body's own shape was
 * not. An inline response schema is a real shape this emitter still has to get right; the machinery
 * to compare one is the same machinery the component arm already uses.
 */
function responseInlineSchema(response: DocumentResponse): JsonSchema | undefined {
	for (const media of Object.values(response.content ?? {})) {
		const schema = media.schema;
		if (schema === undefined) continue;
		if (typeof (schema as { $ref?: unknown }).$ref === "string") return undefined;
		return schema as JsonSchema;
	}
	return undefined;
}

/**
 * Whether the document describes the ITEMS of a stream rather than a body.
 *
 * **OpenAPI 3.2 publishes `itemSchema` for a streamed response and no `schema` at all**, because the
 * body is a byte stream and what it carries is a sequence of events. 3.1 cannot say that, so openapi3
 * falls back to `{"type": "string"}` and warns.
 *
 * **A third answer, and folding it into "unreadable" would be wrong in both directions.** "We could
 * not read what the document said" and "the document deliberately describes something other than a
 * body" are different facts, and only the first is a gap in this harness. Naming it is also what
 * keeps the number honest: a count moving by three says nothing about WHICH three.
 */
function responseDescribesStreamItems(response: DocumentResponse): boolean {
	for (const media of Object.values(response.content ?? {})) {
		if (media.itemSchema !== undefined && media.schema === undefined) return true;
	}
	return false;
}

/** Whether the document's response carries a body at all - an empty `content` is a bodyless arm. */
function responseHasBody(response: DocumentResponse): boolean {
	return Object.keys(response.content ?? {}).length > 0;
}

/**
 * Every component a payload can actually reach, followed transitively from `paths`.
 *
 * **"The oracle is being unfair to us" is the reasoning to distrust, so this MEASURES rather than
 * argues.** Four of the seven `no-zod-declaration` entries were components no request or response
 * can reach: `MyFlow` is an OAuth2 flow DESCRIPTION that openapi3 publishes as a component while
 * inlining its values into `securitySchemes`, and one spread source is declared without ever
 * appearing in a payload. A validator for those would guard a wire position that does not exist.
 *
 * Reachability is read from `paths` alone - request bodies, responses, parameter schemas - because
 * that is the definition of "a payload can reach it". Everything unreachable is COUNTED, never
 * silently dropped, so narrowing the gate stays visible as a number.
 *
 * Guessing which ones these were got it wrong: `Model.CompositeRequestOnlyWithBody` looked like a
 * real missing validator and is not, while two of its neighbours are.
 */
function componentsReachableFromPaths(document: OpenApiDocument): Set<string> {
	const schemas = document.components?.schemas ?? {};
	const reached = new Set<string>();
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		if (typeof node !== "object" || node === null) return;
		for (const [key, value] of Object.entries(node)) {
			if (key === "$ref" && typeof value === "string") {
				const id = value.replace("#/components/schemas/", "");
				if (id !== value && !reached.has(id)) {
					reached.add(id);
					visit(schemas[id]);
				}
				continue;
			}
			visit(value);
		}
	};
	visit(document.paths ?? {});
	return reached;
}

interface Divergence {
	readonly kind: string;
	readonly where: string;
	readonly detail: string;
}

/**
 * **The third oracle axis: the emitted validator, converted BACK to JSON Schema by Zod itself.**
 *
 * **Every other arm in this file compares the two artefacts through describers WE wrote, and that
 * is the weak point rather than a theoretical one.** Four of the defects found during the extraction
 * were in those describers and every one accused the emitter falsely - a constraint reader that
 * stopped at an `anyOf`, an optionality reader that could not see through `z.preprocess`, a test that
 * demanded `"$select"` be quoted. `shape.ts` reconstructs a schema by hand from Zod's INTERNAL
 * `._zod.def` across 788 lines; nothing obliges Zod to keep that stable across the `^4.0.0` range
 * this package advertises.
 *
 * `z.toJSONSchema()` is Zod's own supported serialiser, so this arm compares two independent
 * implementations - openapi3's TypeSpec->JSON Schema against Zod's Zod->JSON Schema - with nothing of
 * ours in between. A defect the two SHARE is still invisible, but a defect in our reading of either
 * side is not, and that is the class that has actually bitten.
 *
 * **`io: "input"` is the correct mode and the choice is load-bearing.** In output mode
 * `z.strictObject` and `z.object` both report `additionalProperties: false` - measured - because the
 * output of a stripping object has only known keys, so openness would silently stop being compared.
 * In input mode the three are distinct: `false`, absent, and `{}` respectively. Input is also what a
 * request contract states: what the validator ACCEPTS.
 */

/** A generated module exports schemas beside plain values; only a schema can be serialised. */
function isZodType(value: unknown): value is z.ZodType {
	return value instanceof z.ZodType;
}

/** What Zod adds or the document annotates - neither is an assertion, so neither is compared. */
const ANNOTATION_KEYWORDS = new Set([
	"$schema",
	"description",
	"title",
	"example",
	"examples",
	"deprecated",
	"readOnly",
	"writeOnly",
	"externalDocs",
	"xml",
	"discriminator",
	/**
	 * **`format` is an ANNOTATION under JSON Schema 2020-12, not an assertion.** An author's
	 * `@format("...")` hint on a plain string is not enforced, and comparing the keyword here would
	 * report every one of those as a divergence.
	 *
	 * A declared TYPE is different and IS enforced - `utcDateTime` is a claim about the value rather
	 * than a hint about it - so Zod emits a pattern for those. Those exact patterns are stripped from
	 * the validator side by `FORMAT_PATTERNS`, because a format fact excluded on the document side and
	 * compared on the other is a false divergence. `test/formats/` asserts the correspondence.
	 */
	"format",
	/**
	 * **`contentEncoding` and `contentMediaType` are annotations too**, by the same clause of the
	 * same specification. The document publishes `contentEncoding: "base64"` for a `bytes` property in
	 * a JSON body; it asserts nothing about the string, and this package's raw-binary decision already
	 * rests on exactly that reading.
	 */
	"contentEncoding",
	"contentMediaType",
]);

/**
 * **Sealed, spelled two ways, meaning one thing.**
 *
 * **`@typespec/openapi3` writes `unevaluatedProperties: {not: {}}` where Zod writes
 * `additionalProperties: false`.** Both say "no property beyond those declared". openapi3 uses the
 * `unevaluated*` form because it composes with `allOf` - an `additionalProperties: false` beside an
 * `allOf` forbids the INHERITED properties too, which is a different and wrong contract. Zod has no
 * `allOf`, so it has no such problem and uses the simpler keyword.
 *
 * Treating the two as a disagreement made this arm report 206 divergences out of 218 comparisons on
 * its first run, against 0 from every other arm over the same components. The gate was wrong, not the
 * emitter - which is this file's most-repeated lesson.
 */

/**
 * **What a schema says about properties it did not declare, from whichever keyword carries it.**
 *
 * Both emitters answer the same two questions - may there be extra properties, and what must they be -
 * and they answer them under different keywords. openapi3 uses `unevaluatedProperties` when the
 * schema composes with `allOf` or when `seal-object-schemas` is on; Zod has no composition and always
 * writes `additionalProperties`.
 *
 * Reading the openness flag from one keyword while reading the VALUE schema only from the other lost
 * the value of every dictionary in the conformance corpus: `unevaluatedProperties: {type: "number"}`
 * read as "open" with no value type, against a Zod side that correctly said the values are numbers.
 * That accounted for 30 of the 67 residual divergences and every one accused the emitter falsely.
 */
function extraPropertyRule(
	source: Record<string, unknown>,
): { sealed: boolean; values?: unknown } | undefined {
	for (const key of ["unevaluatedProperties", "additionalProperties"]) {
		const rule = source[key];
		if (rule === undefined) continue;
		if (rule === false) return { sealed: true };
		if (rule === true) return { sealed: false };
		if (typeof rule !== "object" || rule === null) continue;
		// `{"not": {}}` is openapi3's way of writing "nothing further is permitted".
		if (JSON.stringify(rule) === '{"not":{}}') return { sealed: true };
		// An empty schema permits anything and asserts nothing about it.
		return Object.keys(rule).length === 0 ? { sealed: false } : { sealed: false, values: rule };
	}
	return undefined;
}

/**
 * **The document composes with `allOf`; Zod cannot, so the emitter flattens.**
 *
 * **Not a disagreement - a difference in what the two languages can say.** openapi3 publishes a
 * derived model as `allOf: [{$ref: Base}]` plus its own properties, because JSON Schema composes.
 * Zod has no `allOf`, so the emitter writes the whole effective shape, base properties included.
 * `Eagle` reads as `allOf[Bird] + {kind}` on one side and as `{kind, wingspan, ...}` on the other, and
 * both describe the same object.
 *
 * Merging the base INTO the document's side is the only comparison that means anything. Properties
 * and `required` union; a cycle stops the walk rather than hanging, and a base that cannot be
 * resolved leaves the `allOf` in place so the difference is reported rather than silently dropped.
 */
function flattenAllOf(
	schema: Record<string, unknown>,
	resolve: RefResolver,
	seen: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
	const composed = schema["allOf"];
	if (!Array.isArray(composed)) return schema;
	const properties: Record<string, unknown> = {};
	const required = new Set<string>();
	/**
	 * **`unevaluatedProperties` is `allOf`-AWARE, and that is the whole reason openapi3 uses it.**
	 * A model extending `Record<float32>` is published as `allOf: [{$ref: TheRecord}]` with
	 * `unevaluatedProperties: {not: {}}`, which does NOT seal the object - the base's
	 * `additionalProperties` has already evaluated those keys, so the typed catchall survives
	 * inheritance. Zod has no such composition, so the emitter writes `.catchall(z.number())` on the
	 * derived model directly, and the two agree.
	 *
	 * Reading the derived model's `{not:{}}` as "sealed" made this arm accuse the emitter on 30
	 * components in `type/property/additional-properties` alone. The emitter was right; the oracle had
	 * flattened the properties and dropped the openness they were inherited with.
	 */
	let inheritedValues: unknown;
	let inheritedOpen = false;
	const merge = (source: Record<string, unknown>): void => {
		const own = source["properties"];
		if (typeof own === "object" && own !== null) Object.assign(properties, own);
		const needs = source["required"];
		if (Array.isArray(needs)) for (const name of needs) required.add(String(name));
		const rule = extraPropertyRule(source);
		if (rule !== undefined && !rule.sealed) {
			inheritedOpen = true;
			if (rule.values !== undefined) inheritedValues = rule.values;
		}
	};
	for (const member of composed) {
		if (typeof member !== "object" || member === null) return schema;
		const ref = (member as { $ref?: unknown }).$ref;
		if (typeof ref !== "string") {
			merge(member as Record<string, unknown>);
			continue;
		}
		if (seen.has(ref)) return schema;
		const target = resolve(ref);
		if (target === undefined) return schema;
		merge(flattenAllOf(target as Record<string, unknown>, resolve, new Set([...seen, ref])));
	}
	merge(schema);
	const { allOf: _allOf, ...rest } = schema;
	const flattened: Record<string, unknown> = { ...rest, properties };
	if (required.size > 0) flattened["required"] = [...required];
	if (inheritedOpen) {
		/**
		 * The base's rule survives the composition, so the flattened form carries it. A base spread from
		 * `Record<unknown>` is open with no value constraint, and reading the derived model's
		 * `unevaluatedProperties: {not: {}}` as sealed loses that.
		 */
		flattened["additionalProperties"] = inheritedValues ?? {};
		delete flattened["unevaluatedProperties"];
	}
	return flattened;
}

/**
 * Zod stamps every `.int()` with JavaScript's safe-integer range. The document states a bound only
 * where the SPEC states one, so the sentinel pair is Zod's artefact rather than a disagreement -
 * removed only when it is exactly the sentinel, so a real `@maxValue(9007199254740991)` still counts.
 */
const SAFE_INTEGER = 9007199254740991;

interface NormaliseContext {
	/** Resolves a `#/components/schemas/X` pointer to the schema it names. */
	readonly resolve: RefResolver;
	/** Whether this emitter declares a component of that name, or inlines it at every use. */
	readonly declared: (name: string) => boolean;
	/** The component currently being compared, which Zod writes as the self-pointer `#`. */
	readonly self: string;
}

/**
 * **Collapse an `anyOf` of single-valued enums into one enum, where the two spell one assertion.**
 *
 * `z.union([z.literal(43.125), z.literal(46.875)])` serialises as `anyOf` of two `const`s; openapi3
 * writes `enum: [43.125, 46.875]` with a single `type`. Both say "one of these values". Collapsed
 * only when every member is a bare enum of the same `type` and carries nothing else, so a union of
 * genuinely different shapes still compares as a union.
 */
function collapseLiteralUnion(node: Record<string, unknown>): Record<string, unknown> {
	const members = node["anyOf"];
	if (!Array.isArray(members) || members.length < 2) return node;
	/**
	 * Grouped BY TYPE rather than collapsed to one, because a union may mix them. `"a" | 2 | 3.3 | true`
	 * is published by openapi3 as three members - one per JSON type, with the two numbers sharing an
	 * `enum` - and by Zod as four, one per literal. Both accept exactly the same four values. Grouping
	 * is the canonical form of "a union of literals" whichever way the two chose to split it.
	 */
	const byType = new Map<unknown, unknown[]>();
	for (const member of members) {
		if (typeof member !== "object" || member === null) return node;
		const entry = member as Record<string, unknown>;
		const keys = Object.keys(entry).toSorted().join(",");
		// `const` has not been folded into `enum` yet when this runs, so accept both spellings.
		const literals =
			keys === "enum,type" && Array.isArray(entry["enum"])
				? entry["enum"]
				: keys === "const,type"
					? [entry["const"]]
					: undefined;
		if (literals === undefined) return node;
		const existing = byType.get(entry["type"]);
		if (existing === undefined) byType.set(entry["type"], [...literals]);
		else existing.push(...literals);
	}
	const grouped = [...byType].map(([type, values]) => ({ enum: values, type }));
	const { anyOf: _anyOf, ...rest } = node;
	// One type left means the union was of a single type, and an `anyOf` of one is that one.
	return grouped.length === 1 ? { ...rest, ...grouped[0] } : { ...rest, anyOf: grouped };
}

/**
 * **One `$ref` wrapped in `allOf` and nothing else is that `$ref`.**
 *
 * openapi3 wraps a reference in a single-member `allOf` wherever it needs a place to hang siblings,
 * which it does for XML-annotated properties among others. Zod writes the bare reference. With one
 * member and no other assertion beside it the two are the same schema.
 */
function collapseSingletonAllOf(node: Record<string, unknown>): Record<string, unknown> {
	const composed = node["allOf"];
	if (!Array.isArray(composed) || composed.length !== 1) return node;
	const only = composed[0];
	if (typeof only !== "object" || only === null) return node;
	const inner = only as Record<string, unknown>;
	if (Object.keys(inner).length !== 1 || typeof inner["$ref"] !== "string") return node;
	const { allOf: _allOf, ...rest } = node;
	// `xml` and friends are annotations; openapi3 hangs them beside the `allOf` it wrapped the
	// reference in, and they assert nothing.
	if (Object.keys(rest).some((key) => !ANNOTATION_KEYWORDS.has(key))) return node;
	return { $ref: inner["$ref"] };
}

/**
 * The exact `pattern` strings Zod serialises for the format checks this emitter now emits.
 *
 * **Generated from the checks themselves, never typed out.** A regex written here by hand would be a
 * second copy of Zod's, and the day Zod changed one this would silently stop stripping and report a
 * divergence on every timestamp in the corpus.
 *
 * They are stripped for the same reason `format` is stripped from the DOCUMENT side: the comparison
 * below is about STRUCTURE, and a format fact excluded on one side and compared on the other is a
 * false divergence rather than a finding. That the emitter honours these types is asserted by
 * `test/formats/`, against the values themselves rather than against a serialisation.
 */
const FORMAT_PATTERNS: ReadonlySet<string> = new Set(
	[z.iso.datetime({ offset: true }), z.iso.date(), z.iso.time(), z.iso.duration(), z.url()].flatMap(
		(check) => {
			const serialised = z.toJSONSchema(check, { io: "output" }) as { pattern?: string };
			return serialised.pattern === undefined ? [] : [serialised.pattern];
		},
	),
);

function normaliseJsonSchema(value: unknown, ctx: NormaliseContext): unknown {
	if (Array.isArray(value)) return value.map((entry) => normaliseJsonSchema(entry, ctx));
	if (value === null || typeof value !== "object") return value;
	let source = value as Record<string, unknown>;
	if (typeof source["pattern"] === "string" && FORMAT_PATTERNS.has(source["pattern"])) {
		const { pattern: _stripped, ...rest } = source;
		source = rest;
	}
	source = collapseSingletonAllOf(source);
	source = collapseLiteralUnion(source);

	/**
	 * **A reference this emitter does not declare is compared INLINE, because that is what it emits.**
	 *
	 * openapi3 names a component for a constrained scalar - `$ref: "Trimmed"`, `$ref: "base64urlBytes"`
	 * - and Zod has no named scalars, so the emitter writes the primitive with its constraints at every
	 * use. Comparing a pointer against the thing it points at would report a divergence on every one.
	 * Only pointers to components the emitter DOES declare stay as pointers, where both sides name the
	 * same thing.
	 */
	const pointer = source["$ref"];
	if (typeof pointer === "string") {
		const name = pointer.replace("#/components/schemas/", "").replace("#/$defs/", "");
		// Zod writes `#` for a component referring to itself; the document names it.
		if (name === "#" || name === "") return { $ref: ctx.self };
		if (!ctx.declared(name)) {
			const target = ctx.resolve(`#/components/schemas/${name}`);
			if (target !== undefined) {
				const { $ref: _ref, ...siblings } = source;
				return normaliseJsonSchema({ ...(target as Record<string, unknown>), ...siblings }, ctx);
			}
		}
		return { $ref: name };
	}

	const out: Record<string, unknown> = {};
	/**
	 * **Absent means OPEN, and both dialects rely on that.** JSON Schema leaves an object unconstrained
	 * when neither keyword appears, so openapi3 omitting them and Zod emitting `{}` say the same thing.
	 * Recorded explicitly on every object so a sealed schema still compares against an open one.
	 */
	if (source["type"] === "object" || source["properties"] !== undefined) {
		const extra = extraPropertyRule(source);
		out["<openness>"] = extra?.sealed === true ? "sealed" : "open";
		if (extra?.values !== undefined) out["<values>"] = normaliseJsonSchema(extra.values, ctx);
	}
	for (const key of Object.keys(source).sort()) {
		if (ANNOTATION_KEYWORDS.has(key)) continue;
		if (key === "unevaluatedProperties" || key === "additionalProperties") continue;
		const entry = source[key];
		// An empty `required` asserts nothing; openapi3 writes it, Zod omits it.
		if (key === "required" && Array.isArray(entry) && entry.length === 0) continue;
		if (source["type"] === "integer" && key === "maximum" && entry === SAFE_INTEGER) continue;
		if (source["type"] === "integer" && key === "minimum" && entry === -SAFE_INTEGER) continue;
		if (key === "const") {
			out["enum"] = [normaliseJsonSchema(entry, ctx)];
			continue;
		}
		if (key === "enum" && Array.isArray(entry) && entry.length === 1) {
			out["enum"] = [normaliseJsonSchema(entry[0], ctx)];
			continue;
		}
		if (key === "$defs") continue;
		// `z.record(z.string(), ...)` emits `propertyNames: {type: "string"}`, which constrains nothing
		// that JSON could violate. A non-trivial `propertyNames` is kept and compared.
		if (key === "propertyNames" && JSON.stringify(entry) === '{"type":"string"}') continue;
		out[key] = normaliseJsonSchema(entry, ctx);
	}
	return out;
}

interface Comparison {
	readonly scenariosDifferentiated: number;
	readonly documentsRead: number;
	readonly objectsCompared: number;
	/**
	 * Components compared as JSON Schema, by Zod's own serialiser against openapi3's - no describer of
	 * ours on either side. Zero means the strongest arm in this file is inert.
	 */
	readonly jsonSchemaCompared: number;
	/** Components `z.toJSONSchema()` cannot serialise at all. Counted, never silently skipped. */
	readonly jsonSchemaUnserialisable: number;
	/** Polymorphic components compared as a choice. Zero means the discriminator arm is inert. */
	readonly unionsCompared: number;
	readonly refConstraintSkips: number;
	/** Parameter groups (one per operation per location) actually compared. Zero means O3 is inert. */
	readonly parametersCompared: number;
	/** Operations whose declared response statuses were compared. Zero means the response arm is inert. */
	readonly responsesCompared: number;
	/** Status->body pairs compared by declared component name. Zero means only the statuses were read. */
	readonly responseBodiesCompared: number;
	/** Responses whose body names no component, or whose entry merges several operations. Counted. */
	readonly negotiatedResponseBodies: number;
	/** Inline response bodies whose SHAPE is compared, not merely counted. */
	readonly inlineResponseBodiesCompared: number;
	/** Bodies neither side reduces to an object shape - a scalar, a stream, a union. */
	readonly unreadableResponseBodies: number;
	readonly streamItemBodies: number;
	/** Non-object response bodies whose top-level KIND is compared. */
	readonly responseBodyKindsCompared: number;
	/** `content-type`/`accept` validators set aside: stated via `content` keys, not as parameters. */
	/**
	 * Content-negotiation headers the parameter arm sets aside, split into the two honest answers.
	 *
	 * **`skipped` used to be the only number, and it was a gap dressed as a measurement.** A
	 * `content-type` validator is not a parameter divergence - OpenAPI states media types through
	 * `content` KEYS rather than as parameters - so the parameter arm has to remove them. Removing
	 * them and counting them left the surface ungraded; removing them and comparing them somewhere
	 * else is what closes it.
	 */
	readonly contentHeaders: { compared: number; skipped: number };
	/** Components no payload can reach, so no validator is owed. Counted, never silently skipped. */
	readonly unreachableComponents: number;
	/** How many constraint keywords were actually READ, per side. Zero means the arm proved nothing. */
	readonly constraintsSeen: { document: number; validator: number };
	/** Document `format` annotations the validator does not enforce - counted, never compared. */
	readonly unenforcedFormats: number;
	/** Array items / dictionary values: read vs unreadable. Zero compared means the arm is inert. */
	/** Places the emitter DECLARED it diverges from the document. Asserted exhaustive; must stay tiny. */
	readonly emitterWarnings: readonly string[];
	readonly elements: { compared: number; skipped: number; unconstrained: number };
	/** Property types: read vs unreadable. The coarsest fact there is, and unchecked until now. */
	readonly kinds: { compared: number; skipped: number; unconstrained: number };
	/** Sources whose document set was reduced to one - versioned services. Counted, not hidden. */
	readonly versionedSourcesNarrowed: readonly string[];
	/** Operations the document declares, and operations we actually mount. */
	readonly operations: { document: number; emitted: number };
	readonly divergences: readonly Divergence[];
	readonly ourFailures: readonly string[];
	readonly oracleFailures: readonly string[];
	/** Request bodies compared by SHAPE, and by top-level KIND where neither side is an object. */
	readonly requestBodiesCompared: number;
	readonly requestBodyKindsCompared: number;
	readonly unreadableRequestBodies: number;
}

/**
 * Every operation the document declares.
 *
 * **The assertion whose absence hid the worst defect in this emitter.** The differential compared
 * components exhaustively and never once asked whether the ROUTES survived. They largely did not:
 * across the corpus the document declared 540 operations and we emitted 256. A baseline of 62
 * component divergences looked like a manageable list while more than half the surface was missing,
 * because nothing counted it. A gate is only as honest as the questions put to it.
 */
function operationsInDocument(document: OpenApiDocument): number {
	const verbs = new Set(["get", "put", "post", "patch", "delete", "head", "options"]);
	let count = 0;
	for (const path of Object.values(document.paths ?? {})) {
		for (const verb of Object.keys(path)) if (verbs.has(verb)) count++;
	}
	return count;
}

/** `openapi.json`, `openapi.v2.json` - never `schemas.gen.ts`, and never the YAML twin. */
const documentsIn = (dir: string): string[] =>
	readdirSync(dir)
		.filter((name) => name.startsWith("openapi") && name.endsWith(".json"))
		.sort();

async function compareEverything(specVersion: string): Promise<Comparison> {
	const divergences: Divergence[] = [];
	const ourFailures: string[] = [];
	const oracleFailures: string[] = [];
	let scenariosDifferentiated = 0;
	/** Documents actually opened. The floor that makes an empty read impossible to mistake for green. */
	let documentsRead = 0;
	let objectsCompared = 0;
	let jsonSchemaCompared = 0;
	let jsonSchemaUnserialisable = 0;
	let unionsCompared = 0;
	let refConstraintSkips = 0;
	let parametersCompared = 0;
	let responsesCompared = 0;
	let responseBodiesCompared = 0;
	let negotiatedResponseBodies = 0;
	let inlineResponseBodiesCompared = 0;
	let unreadableResponseBodies = 0;
	/** Responses whose body the document describes as stream ITEMS - a 3.2 shape, not a gap. */
	let streamItemBodies = 0;
	let responseBodyKindsCompared = 0;
	let requestBodiesCompared = 0;
	let requestBodyKindsCompared = 0;
	let unreadableRequestBodies = 0;
	const contentHeaders = { compared: 0, skipped: 0 };
	let unreachableComponents = 0;
	const constraintsSeen = { document: 0, validator: 0 };
	const versionedSourcesNarrowed: string[] = [];
	const operations = { document: 0, emitted: 0 };
	const formatCounter = { count: 0 };
	const elementCounter = { compared: 0, skipped: 0, unconstrained: 0 };
	const kindCounter = { compared: 0, skipped: 0, unconstrained: 0 };
	const emitterWarnings: string[] = [];

	const add = (kind: string, where: string, detail: string): void => {
		divergences.push({ kind, where, detail });
	};

	const sources: CompiledScenario[] = [];
	// Breadth from a corpus nobody here chose, depth from fixtures written for the gaps it leaves.
	for (const scenario of [...discoverScenarios(), ...depthSources()]) {
		try {
			sources.push(await compileScenario(scenario));
		} catch (thrown) {
			ourFailures.push(`${scenario.name} :: harness :: ${String(thrown).slice(0, 80)}`);
		}
	}

	for (const compiled of sources) {
		const scenario = compiled.scenario;
		if (compiled.failure !== undefined) {
			const line = `${scenario.name} :: ${compiled.failure.code}`;
			(compiled.failure.owner === "ours" ? ourFailures : oracleFailures).push(line);
			continue;
		}
		emitterWarnings.push(...(compiled.emitterWarnings ?? []));
		scenariosDifferentiated++;

		/**
		 * **A versioned service emits one document per version; we emit one schema set.**
		 * Measured on `versioning/added`: the v1 document's `ModelV1` omits `unionProp`, the v2
		 * document requires it, and we emit the v2 shape. So the latest document is the one we can
		 * honestly be compared against - and "we serve only the latest version" is a real limitation,
		 * recorded here rather than hidden by comparing against whichever file sorted first.
		 */
		const versionDir = openapiDirFor(compiled.openapiDir, specVersion);
		const documents = documentsIn(versionDir);
		/**
		 * **A scenario with no document is a harness failure, never a quiet skip.**
		 *
		 * openapi3 relocates its output into per-version subdirectories the moment more than one
		 * version is requested - see `openapiDirFor`. A reader still assuming the flat layout finds an
		 * empty list, and every arm below then agrees with nothing at all. Named here, and floored by
		 * `documentsRead`, because the same mistake next door returns early and reports success.
		 */
		if (documents.length === 0) {
			ourFailures.push(`${scenario.name} :: harness :: no document at ${specVersion}`);
			continue;
		}
		documentsRead += documents.length;
		if (documents.length > 1) {
			// Not a silent cap: a versioned service is compared against its LATEST document only,
			// because that is the single shape we emit. Recorded so the reduction stays a number.
			versionedSourcesNarrowed.push(`${scenario.name} (${documents.length} documents)`);
		}
		/**
		 * **The document the emitter corresponds to, chosen by DECLARED version order.**
		 *
		 * This was `documents.at(-1)` - the last filename alphabetically - and for
		 * `versioning/removed` that is `openapi.v2preview.json`. The spec declares `v1, v2preview, v2`,
		 * so the current version is v2, and the emitter emits v2. The oracle was comparing correct
		 * output against a PREVIEW and reporting the difference as our defect. Seven sources are
		 * versioned; any of them could as easily have had a real divergence masked by an older version
		 * happening to agree.
		 */
		const chosen =
			compiled.latestVersion === undefined
				? documents.at(-1)
				: (documents.find((name) => name === `openapi.${compiled.latestVersion}.json`) ??
					documents.at(-1));
		const document = JSON.parse(
			readFileSync(join(versionDir, chosen ?? ""), "utf8"),
		) as OpenApiDocument;
		const emitted = (await import(join(compiled.zodDir, "schemas.gen.ts"))) as Record<
			string,
			unknown
		>;

		// Schema object -> declared name, so an array of `Bird` can be told from an array of strings.
		const nameOf = namesFromModule(emitted);

		const declaredOperations = operationsInDocument(document);
		/**
		 * **The generated SERVER, which no oracle had ever read.** `schemas.gen.ts` holds the
		 * component validators; the per-route path, query and header validators live here, and until
		 * they were exported nothing outside this file could name one. Two live defects were sitting
		 * in that gap - a header validator keyed on the TypeSpec name rather than the wire name, and a
		 * hyphenated path parameter that mounted an unreachable route.
		 */
		/**
		 * **Every operation the document declares, against the validators emitted for it.**
		 *
		 * **This arm used to mount the generated Hono server and read `app.routes`.** That was the
		 * right measurement for a server generator and it is not this package's to make: whether a
		 * route can be reached is a router's property, and belongs to the emitter that writes one.
		 *
		 * What IS this package's is narrower and was the original defect anyway. `collectRoutes` once
		 * skipped every operation whose success body it could not resolve, silently - measured across
		 * the corpus, the document declared 540 operations and 284 produced nothing at all, 282 of them
		 * merely bodyless. A bodyless success is ordinary HTTP, not an edge case.
		 *
		 * Every operation gets a `<operationId>Responses`, unconditionally, because every operation
		 * declares at least its success status. So its absence is exactly "this operation was dropped",
		 * with no interpretation in between.
		 */
		operations.document += declaredOperations;
		const withArms = Object.keys(emitted).filter((name) => name.endsWith("Responses")).length;
		operations.emitted += withArms;
		if (withArms !== declaredOperations) {
			/**
			 * **Not always a defect, and saying so is the point.** openapi3 merges several TypeSpec
			 * operations onto one document entry when they share a route and negotiate on content type,
			 * so a negotiated scenario legitimately emits MORE arms than the document has entries. Only
			 * the other direction is a dropped operation.
			 */
			if (withArms < declaredOperations) {
				add(
					"dropped-operations",
					scenario.name,
					`document=${declaredOperations} emitted=${withArms}`,
				);
			}
		}

		/** Lets a property's EFFECTIVE constraints be read through a named scalar - see `shape.ts`. */
		const schemas = document.components?.schemas ?? {};
		const resolve: RefResolver = (ref) => schemas[ref.replace("#/components/schemas/", "")];

		/**
		 * **Every parameter the document declares, against the validator that actually guards it.**
		 *
		 * **This surface was ungraded for the entire life of the oracle.** The loop below iterates
		 * `components.schemas`; a parameter schema is not a component, so nothing compared what the
		 * validator guards a path, a query string or a header. Only route COUNTS were checked, which is
		 * how a route mounted at the literal string `/things/{thing-id}` passed as present while
		 * answering 404 to everything.
		 */
		const parameterRefs = document.components?.parameters ?? {};
		for (const operations_ of Object.values(document.paths ?? {})) {
			const shared =
				(operations_ as { parameters?: readonly DocumentParameter[] }).parameters ?? [];
			for (const [verb, raw] of Object.entries(operations_)) {
				if (verb === "parameters") continue;
				const operation = raw as DocumentOperation;
				const operationId = operation.operationId;
				if (operationId === undefined) continue;
				// Path-level parameters apply to every operation on the path; a `$ref` points into
				// `components.parameters`, which is a different map from `components.schemas`.
				const declared = [...shared, ...(operation.parameters ?? [])].map((parameter) =>
					parameter.$ref === undefined
						? parameter
						: (parameterRefs[parameter.$ref.replace("#/components/parameters/", "")] ?? parameter),
				);
				for (const target of PARAMETER_TARGETS) {
					const json = parametersAsSchema(declared, target.in);
					const validator = validatorFor(emitted, operationId, target.suffix);
					if (json === undefined) {
						// The reverse direction: a validator guarding something the document never declared
						// would reject conformant requests, so it is a divergence too.
						const surplus = withoutContentHeaders(describeZodObject(validator, nameOf), () => {
							contentHeaders.skipped++;
						});
						if (surplus !== undefined && Object.keys(surplus.properties).length > 0) {
							add(
								"undeclared-parameter-validator",
								`${scenario.name}:${operationId}`,
								`${target.in} validator guards [${Object.keys(surplus.properties)}], document declares no ${target.in} parameter`,
							);
						}
						continue;
					}
					const fromDocument = describeDocumentObject(json, resolve);
					const fromZod = withoutContentHeaders(describeZodObject(validator, nameOf), () => {
						contentHeaders.skipped++;
					});
					if (fromDocument === undefined) continue;
					if (fromZod === undefined) {
						add(
							"no-parameter-validator",
							`${scenario.name}:${operationId}`,
							`${target.in}: expected ${operationId}${target.suffix} to validate [${Object.keys(json.properties ?? {})}]`,
						);
						continue;
					}
					parametersCompared++;
					compareShapes(
						scenario.name,
						`${operationId}.${target.in}`,
						json,
						fromDocument,
						fromZod,
						add,
						constraintsSeen,
						resolve,
						formatCounter,
						elementCounter,
						kindCounter,
					);
				}

				/**
				 * **What a caller may SEND, compared against the validator that guards it.**
				 *
				 * **This surface had no arm at all.** Parameters were graded, responses were graded, and
				 * the request body - the largest surface of most APIs - was compared by nothing. A body
				 * the document publishes as a string and the validator requires as an object rejects every
				 * conformant caller, and would have passed here.
				 *
				 * The same two readings as the response side: a shape where both sides reduce to an
				 * object, a top-level kind where they do not, and a count where neither can be read.
				 */
				const requestBody = requestBodySchema(operation);
				const bodyValidator = validatorFor(emitted, operationId, "Body");
				if (requestBody !== undefined && bodyValidator !== undefined) {
					const target =
						requestBody.component === undefined
							? requestBody.schema
							: (schemas[requestBody.component] ?? requestBody.schema);
					const fromDocument = describeDocumentObject(target, resolve);
					const fromZod = describeZodObject(bodyValidator, nameOf);
					if (fromDocument !== undefined && fromZod !== undefined) {
						requestBodiesCompared++;
						compareShapes(
							scenario.name,
							`${operationId}.requestBody`,
							target,
							fromDocument,
							fromZod,
							add,
							constraintsSeen,
							resolve,
							formatCounter,
							elementCounter,
							kindCounter,
						);
					} else {
						const documentKind = topLevelKindOfDocument(target, resolve);
						const zodKind = topLevelKindOfZod(bodyValidator);
						if (documentKind === undefined || zodKind === undefined) {
							unreadableRequestBodies++;
						} else {
							requestBodyKindsCompared++;
							if (documentKind !== zodKind) {
								add(
									"request-body-kind",
									`${scenario.name}:${operationId}`,
									`document=${documentKind} emitted=${zodKind}`,
								);
							}
						}
					}
				}

				/**
				 * **The content-negotiation headers, compared against the KEYS that state them.**
				 *
				 * **This surface was counted and not graded.** `@header contentType: "application/json"`
				 * emits a validator property, and the document declares no such parameter - it declares
				 * `requestBody.content["application/json"]`. So the parameter arm removes them, which is
				 * correct, and for a long time that was the end of it: a number called
				 * `contentHeadersSkipped` that nobody could act on.
				 *
				 * The document does state them, just somewhere else. A `content-type` validator is
				 * checked against the request body's media types and an `accept` validator against the
				 * union of the responses'. A validator accepting a media type the document never offers
				 * refuses nothing it should and accepts something it should not; the reverse rejects a
				 * conformant caller.
				 *
				 * **`accept` is absent on a NEGOTIATED route, by design.** There it selects which
				 * operation answers, so validating it against one member's literal would 400 a
				 * well-formed request whose real answer is 406. Absent is the correct reading, and only
				 * a PRESENT validator is compared.
				 */
				const headerValidator = validatorFor(emitted, operationId, "Header");
				for (const [header, expected] of [
					["content-type", requestMediaTypes(operation)],
					["accept", responseMediaTypes(operation)],
				] as const) {
					const accepted = mediaTypesAccepted(headerValidator, header);
					if (accepted === undefined) continue;
					if (expected.length === 0) {
						// A validator guarding a media type the document names nowhere.
						contentHeaders.skipped++;
						add(
							"content-header",
							`${scenario.name}:${operationId}`,
							`${header} validator accepts [${accepted.toSorted()}], document names no media type`,
						);
						continue;
					}
					contentHeaders.compared++;
					const surplus = accepted.filter((type) => !expected.includes(type)).toSorted();
					if (surplus.length > 0) {
						add(
							"content-header",
							`${scenario.name}:${operationId}`,
							`${header} validator accepts [${surplus}] which the document does not offer (document=[${expected}])`,
						);
					}
				}

				/**
				 * **What the operation may ANSWER with - the surface no oracle had opened.**
				 *
				 * Every arm in this file until now graded the request: components, and then path,
				 * query and header parameters. What the operation is allowed to answer with - which statuses it
				 * declares and which body each one carries - was compared against nothing, even though
				 * the emitter passes exactly that to `deps.respond` and an application checks its own
				 * output against it. A status the document declares and the emitter omits is a response
				 * a runtime cannot validate at all; a status the emitter invents is one the contract
				 * does not permit.
				 */
				const declaredStatuses = Object.keys(operation.responses ?? {}).toSorted();
				if (declaredStatuses.length > 0) {
					const emittedArms = responseArmsFor(emitted, operationId);
					if (emittedArms === undefined) {
						add(
							"no-response-arms",
							`${scenario.name}:${operationId}`,
							`document declares [${declaredStatuses}], emitter declared no arms`,
						);
					} else {
						responsesCompared++;
						const armStatuses = [
							...new Set(emittedArms.arms.map((arm) => String(arm.status))),
						].toSorted();
						if (armStatuses.join(",") !== declaredStatuses.join(",")) {
							add(
								"response-statuses",
								`${scenario.name}:${operationId}`,
								`document=[${declaredStatuses}] emitted=[${armStatuses}]`,
							);
						}
						/**
						 * **Which BODY each status carries, not merely that the status exists.** The
						 * arms used to hand every failure the service-wide error schema, so a document
						 * naming a different component per status was answered with the wrong one - and
						 * because both shapes were separately correct as components, the component walk
						 * agreed about each of them individually.
						 *
						 * Read by declared name rather than by shape: two models that happen to match
						 * today are still the wrong reference, and this is the only arm positioned to
						 * say so.
						 */
						for (const status of declaredStatuses) {
							const response = operation.responses?.[status];
							if (response === undefined) continue;
							const arm = emittedArms.arms.find((candidate) => String(candidate.status) === status);
							if (arm === undefined) continue;
							if (!responseHasBody(response)) {
								if (arm.schema !== undefined) {
									add(
										"response-body",
										`${scenario.name}:${operationId}.${status}`,
										`document declares no body, emitter validates against ${nameOf(arm.schema) ?? "a schema"}`,
									);
								}
								continue;
							}
							const component = responseComponentOf(response);
							/**
							 * **A NEGOTIATED entry genuinely cannot be attributed here** - openapi3 lists
							 * one body per media type against members that each carry their own, so there is
							 * no single arm to compare it to. That stays counted, and the status arm above
							 * still covers it.
							 */
							if (emittedArms.merged) {
								negotiatedResponseBodies++;
								continue;
							}
							/**
							 * An INLINE body names no component, so there is no name to compare - but there is
							 * a shape, and comparing shapes is what the component walk already does. This was
							 * counted and skipped for 76 positions; comparing them is what closes it.
							 */
							if (component === undefined) {
								const inline = responseInlineSchema(response);
								const fromDocument =
									inline === undefined ? undefined : describeDocumentObject(inline, resolve);
								const fromZod =
									arm.schema === undefined ? undefined : describeZodObject(arm.schema, nameOf);
								if (inline === undefined || fromDocument === undefined || fromZod === undefined) {
									/**
									 * Not an object on one side or both - a scalar body, a stream, a union. The
									 * shape walk has nothing to say, but the KIND does: a body the document
									 * publishes as `{"type": "string"}` and the emitter validates as a number
									 * is a defect nothing else here would see.
									 */
									const documentKind =
										inline === undefined ? undefined : topLevelKindOfDocument(inline, resolve);
									const zodKind =
										arm.schema === undefined ? undefined : topLevelKindOfZod(arm.schema);
									if (documentKind === undefined || zodKind === undefined) {
										// A streamed response is not unreadable - see `responseDescribesStreamItems`.
										if (responseDescribesStreamItems(response)) {
											streamItemBodies++;
											continue;
										}
										// Unreadable on one side. Counted, never silently passed.
										unreadableResponseBodies++;
										continue;
									}
									responseBodyKindsCompared++;
									if (documentKind !== zodKind) {
										add(
											"response-body-kind",
											`${scenario.name}:${operationId}.${status}`,
											`document=${documentKind} emitted=${zodKind}`,
										);
									}
									continue;
								}
								inlineResponseBodiesCompared++;
								compareShapes(
									scenario.name,
									`${operationId}.${status}`,
									inline,
									fromDocument,
									fromZod,
									add,
									constraintsSeen,
									resolve,
									formatCounter,
									elementCounter,
									kindCounter,
								);
								continue;
							}
							const expected = component.split(".").at(-1) ?? component;
							/**
							 * **openapi3 publishes a component for things this emitter inlines**, and a
							 * name comparison would read that as a wrong body. `encode/bytes` declares the
							 * scalar `base64urlBytes` as a component; we emit `z.string()` at the position,
							 * which is the same contract and has no name to be compared by.
							 *
							 * **The test is what the component IS, never whether we happened to declare
							 * it.** The first cut skipped when `emitted[identifier]` was absent, which reads
							 * "the emitter inlines this by design" and "the emitter declared nothing at all"
							 * as the same thing - and a control proved it: handing every failure arm the
							 * service-wide error schema, the exact defect this arm exists to catch, went
							 * unreported because the component it should have named had also stopped being
							 * declared. A guard that looks present.
							 *
							 * So the skip needs BOTH halves, and measuring which components the two halves
							 * disagree about is what settled it: `DaysOfWeekEnum`, `DaysOfWeekExtensibleEnum`
							 * and two empty models are declared by this emitter while reading as no object
							 * shape at all, so the shape test alone silently stopped checking them.
							 *
							 * Excused only when the emitter declared nothing AND the document's component is
							 * not one a declaration is owed for. A component that IS owed one and does not
							 * have it stays compared, and reports the wrong body - which is exactly what the
							 * control above demands.
							 */
							const target = schemas[component] ?? {};
							const owedDeclaration =
								describeDocumentObject(target, resolve) !== undefined ||
								describeDocumentDiscriminator(target) !== undefined;
							if (emitted[identifierFor(component)] === undefined && !owedDeclaration) {
								negotiatedResponseBodies++;
								continue;
							}
							responseBodiesCompared++;
							const actual = arm.schema === undefined ? undefined : nameOf(arm.schema);
							if (actual !== expected) {
								add(
									"response-body",
									`${scenario.name}:${operationId}.${status}`,
									`document=${expected} emitted=${actual ?? "no schema"}`,
								);
							}
						}
					}
				}
			}
		}

		const reachable = componentsReachableFromPaths(document);
		/**
		 * Every component's validator under the name the DOCUMENT gives it, so a nested reference
		 * serialises as `#/$defs/<Name>` rather than being inlined. Inlining would compare a nested
		 * model against a `$ref` and diverge on every one of them, and would not terminate on the
		 * recursive fixtures at all.
		 */
		const jsonSchemaRegistry = z.registry<{ id: string }>();
		for (const component of Object.keys(document.components?.schemas ?? {})) {
			const validator = emitted[identifierFor(component)];
			if (isZodType(validator)) jsonSchemaRegistry.add(validator, { id: component });
		}
		const claimed = new Map<string, string>();
		for (const [component, json] of Object.entries(document.components?.schemas ?? {})) {
			const identifier = identifierFor(component);
			const fromDocument = describeDocumentObject(json, resolve);
			const fromZod = describeZodObject(emitted[identifier], nameOf);

			// Only a collision between components we actually EMIT can produce a duplicate declaration;
			// two scalars sharing a bare name cost nothing because neither is declared.
			if (fromZod !== undefined && claimed.has(identifier)) {
				add(
					"component-name-collision",
					`${scenario.name}:${component}`,
					`also claimed by ${claimed.get(identifier)}`,
				);
			}
			if (fromZod !== undefined) claimed.set(identifier, component);

			/**
			 * A polymorphic component is compared as a CHOICE, not as an object.
			 *
			 * Both artefacts stop describing a shape here: the document publishes a `discriminator`
			 * with a mapping, and the emitter answers with `z.discriminatedUnion`. Comparing the two
			 * as objects made every discriminated base read as having no validator at all.
			 */
			const unionFromDocument = describeDocumentDiscriminator(json);
			if (unionFromDocument !== undefined) {
				const unionFromZod = describeZodDiscriminatedUnion(emitted[identifier]);
				if (unionFromZod === undefined) {
					add("no-discriminated-union", `${scenario.name}:${component}`, `expected ${identifier}`);
					continue;
				}
				unionsCompared++;
				if (unionFromDocument.discriminator !== unionFromZod.discriminator) {
					add(
						"discriminator-property",
						`${scenario.name}:${component}`,
						`document=${unionFromDocument.discriminator} validator=${unionFromZod.discriminator}`,
					);
				}
				// The set of subtypes, not their count: a validator switching on the right property
				// while accepting the wrong values is the failure this arm exists for.
				const documentValues = unionFromDocument.values.join(",");
				const zodValues = unionFromZod.values.join(",");
				if (documentValues !== zodValues) {
					add(
						"discriminator-values",
						`${scenario.name}:${component}`,
						`document=[${documentValues}] validator=[${zodValues}]`,
					);
				}
				continue;
			}

			if (fromDocument === undefined) continue;
			if (fromZod === undefined) {
				// A component nothing on the wire can reach needs no validator - but the reduction in
				// what this arm checks is a number, not a silence.
				if (reachable.has(component)) {
					add("no-zod-declaration", `${scenario.name}:${component}`, `expected ${identifier}`);
				} else unreachableComponents++;
				continue;
			}
			/**
			 * **The third axis, on the same pair the shape arm is about to compare.**
			 *
			 * Run here rather than in a suite of its own so both sides come from ONE compile: comparing
			 * against a second compile would make every disagreement ambiguous, which is the same reason
			 * both emitters already run from one program.
			 */
			const validator = emitted[identifierFor(component)];
			if (isZodType(validator)) {
				let serialised: unknown;
				try {
					serialised = z.toJSONSchema(validator, {
						io: "input",
						metadata: jsonSchemaRegistry,
					});
				} catch {
					/**
					 * **Counted, not swallowed.** Zod refuses to serialise some constructs - a
					 * transform has no JSON Schema meaning. This emitter emits none, so this should stay
					 * at zero; if it climbs, the arm is quietly comparing less than it reports.
					 */
					jsonSchemaUnserialisable++;
					serialised = undefined;
				}
				if (serialised !== undefined) {
					jsonSchemaCompared++;
					const normaliseContext = {
						resolve,
						declared: (name: string) => emitted[identifierFor(name)] !== undefined,
						self: component,
					};
					const fromDocumentJson = JSON.stringify(
						normaliseJsonSchema(
							flattenAllOf(json as Record<string, unknown>, resolve),
							normaliseContext,
						),
					);
					const fromZodJson = JSON.stringify(normaliseJsonSchema(serialised, normaliseContext));
					if (fromDocumentJson !== fromZodJson) {
						add(
							"json-schema",
							`${scenario.name}:${component}`,
							`document=${fromDocumentJson} validator=${fromZodJson}`,
						);
					}
				}
			}

			objectsCompared++;
			refConstraintSkips += compareShapes(
				scenario.name,
				component,
				json,
				fromDocument,
				fromZod,
				add,
				constraintsSeen,
				resolve,
				formatCounter,
				elementCounter,
				kindCounter,
			);
		}
	}

	return {
		scenariosDifferentiated,
		documentsRead,
		objectsCompared,
		jsonSchemaCompared,
		jsonSchemaUnserialisable,
		parametersCompared,
		responsesCompared,
		responseBodiesCompared,
		negotiatedResponseBodies,
		inlineResponseBodiesCompared,
		unreadableResponseBodies,
		streamItemBodies,
		responseBodyKindsCompared,
		requestBodiesCompared,
		requestBodyKindsCompared,
		unreadableRequestBodies,
		contentHeaders,
		unreachableComponents,
		unionsCompared,
		refConstraintSkips,
		constraintsSeen,
		unenforcedFormats: formatCounter.count,
		emitterWarnings: emitterWarnings.toSorted(),
		elements: elementCounter,
		kinds: kindCounter,
		versionedSourcesNarrowed,
		operations,
		divergences,
		ourFailures,
		oracleFailures,
	};
}

/** Returns how many properties had constraints that could not be read at all. */
function compareShapes(
	scenarioName: string,
	component: string,
	json: JsonSchema,
	fromDocument: ObjectShape,
	fromZod: ObjectShape,
	add: (kind: string, where: string, detail: string) => void,
	constraintsSeen: { document: number; validator: number },
	resolve: RefResolver,
	formats: { count: number },
	elements: { compared: number; skipped: number; unconstrained: number },
	kinds: { compared: number; skipped: number; unconstrained: number },
): number {
	const at = `${scenarioName}:${component}`;
	if (fromDocument.openness !== fromZod.openness) {
		add("openness", at, `document=${fromDocument.openness} validator=${fromZod.openness}`);
	}
	const documentNames = Object.keys(fromDocument.properties).toSorted();
	const zodNames = Object.keys(fromZod.properties).toSorted();
	if (documentNames.join(",") !== zodNames.join(",")) {
		add("property-names", at, `document=[${documentNames}] validator=[${zodNames}]`);
		// Comparing per-property beyond this point compares properties that are not the same property.
		return 0;
	}
	let skips = 0;
	for (const name of documentNames) {
		const expected = fromDocument.properties[name];
		const actual = fromZod.properties[name];
		if (expected === undefined || actual === undefined) continue;
		if (expected.required !== actual.required) {
			add(
				"required",
				`${at}.${name}`,
				`document=${expected.required} validator=${actual.required}`,
			);
		}
		if (expected.nullable !== actual.nullable) {
			add(
				"nullable",
				`${at}.${name}`,
				`document=${expected.nullable} validator=${actual.nullable}`,
			);
		}
		// Through `allOf` as well as the object's own properties - see `propertySchemaOf`. Reading only
		// `json.properties` skipped every INHERITED property here, so the whole tail below (kind,
		// element, format, constraints) went unread for the inherited half of every derived model.
		const property = propertySchemaOf(json, name, resolve);
		if (property === undefined || isUnresolvable(property, resolve)) {
			skips++;
			continue;
		}
		if (expected.format !== undefined) formats.count++;
		/**
		 * What the container HOLDS, which every other field here agrees about regardless.
		 *
		 * A property described as "an array, required, not nullable" reads identically whether it
		 * holds `Bird` or `string`, so this is the only arm that can tell those apart. Counted as well
		 * as compared: an arm that finds no elements to look at is not an arm that found agreement.
		 */
		/**
		 * **Compared only when BOTH sides could be read, and every skip is counted.**
		 *
		 * The first cut of these arms reported `document=undefined validator=string` - 17 of 28 hits
		 * were the describer failing on a nullable array or an unresolvable `$ref`, not the emitter
		 * disagreeing. Baselining those would have published describer gaps as emitter defects and
		 * buried the three real ones among them.
		 */
		/**
		 * **`"any"` is a READING, so these comparisons happen - and until they did, a validator
		 * that OVER-constrained an open value was invisible.** The document's empty schema `{}` says
		 * "anything"; the harness used to collapse that to `undefined` and skip, and the skip counted
		 * as coverage. Under-constraining was always caught, because both sides read; the blindness
		 * was one-directional, which is why nothing noticed it for the whole life of this oracle.
		 *
		 * Counted separately from `compared` so the arm cannot go quiet unnoticed: if the predicate
		 * stops firing, `unconstrained` falls to zero and the floor below fails, rather than the suite
		 * reporting agreement about nothing.
		 */
		if (expected.kind !== undefined && actual.kind !== undefined) {
			kinds.compared++;
			if (expected.kind === "any" || actual.kind === "any") kinds.unconstrained++;
			if (expected.kind !== actual.kind) {
				add("property-type", `${at}.${name}`, `document=${expected.kind} validator=${actual.kind}`);
			}
		} else kinds.skipped++;
		if (expected.element !== undefined && actual.element !== undefined) {
			elements.compared++;
			if (expected.element === "any" || actual.element === "any") elements.unconstrained++;
			if (expected.element !== actual.element) {
				add(
					"element-type",
					`${at}.${name}`,
					`document=${expected.element} validator=${actual.element}`,
				);
			}
		} else if (expected.element !== undefined || actual.element !== undefined) elements.skipped++;
		constraintsSeen.document += Object.keys(expected.constraints).length;
		constraintsSeen.validator += Object.keys(actual.constraints).length;
		for (const keyword of new Set([
			...Object.keys(expected.constraints),
			...Object.keys(actual.constraints),
		])) {
			if (String(expected.constraints[keyword]) !== String(actual.constraints[keyword])) {
				add(
					`constraint:${keyword}`,
					`${at}.${name}`,
					`document=${expected.constraints[keyword]} validator=${actual.constraints[keyword]}`,
				);
			}
		}
	}
	return skips;
}

interface Baseline {
	readonly note: string;
	/** Scenarios OUR emitter cannot compile. Each must name the diagnostic it produces. */
	readonly ourFailures: readonly string[];
	/** Scenarios `@typespec/openapi3` itself cannot compile - no oracle, and not our defect. */
	readonly oracleFailures: readonly string[];
	/** `kind` -> the exact `where` strings known to diverge. */
	readonly divergences: Readonly<Record<string, readonly string[]>>;
	/**
	 * Warnings THIS emitter raised across the corpus. Every one means "the output is knowingly not
	 * what the document says, and we are shipping it anyway". Asserted EMPTY.
	 */
	readonly emitterWarnings?: readonly string[];
	/** Document `format` annotations the validator does not enforce. Not a defect; a decision owed. */
	readonly unenforcedFormats: number;
	/** Versioned sources compared against their latest document only. */
	readonly versionedSourcesNarrowed: readonly string[];
	/** Operations declared vs mounted. Must move toward equality and never away from it. */
	readonly operations: { document: number; emitted: number };
	/** Negotiated response bodies, which no single arm can be attributed to. Pinned. */
	readonly negotiatedResponseBodies: number;
	/** Inline response bodies whose SHAPE is compared. Coverage - may only grow. */
	readonly inlineResponseBodiesCompared: number;
	/** Bodies neither side reduces to an object OR a readable kind. Pinned. */
	readonly unreadableResponseBodies: number;
	/** Non-object response bodies whose top-level KIND is compared. Coverage - may only grow. */
	readonly responseBodyKindsCompared: number;
	readonly requestBodiesCompared: number;
	readonly requestBodyKindsCompared: number;
	readonly unreadableRequestBodies: number;
}

let comparison: Comparison;
/**
 * The same corpus, compared against the SECOND graded document version.
 *
 * One compile produced both documents - see `GRADED_OPENAPI_VERSIONS` - so this is a second reading
 * of one program rather than a second build of it.
 */
let comparisonAtLater: Comparison;
let baseline: Baseline;

beforeAll(async () => {
	comparison = await compareEverything(GRADED_OPENAPI_VERSIONS[0]);
	comparisonAtLater = await compareEverything(GRADED_OPENAPI_VERSIONS[1]);
	if (process.env.UPDATE_CONFORMANCE_BASELINE === "1") {
		const grouped: Record<string, string[]> = {};
		for (const divergence of comparison.divergences) {
			(grouped[divergence.kind] ??= []).push(divergence.where);
		}
		for (const list of Object.values(grouped)) list.sort();
		writeFileSync(
			baselinePath,
			`${JSON.stringify(
				{
					note: "Generated by UPDATE_CONFORMANCE_BASELINE=1. This file may only SHRINK - an addition needs a named reason in the commit message. See differential.test.ts.",
					unenforcedFormats: comparison.unenforcedFormats,
					negotiatedResponseBodies: comparison.negotiatedResponseBodies,
					inlineResponseBodiesCompared: comparison.inlineResponseBodiesCompared,
					unreadableResponseBodies: comparison.unreadableResponseBodies,
					responseBodyKindsCompared: comparison.responseBodyKindsCompared,
					requestBodiesCompared: comparison.requestBodiesCompared,
					requestBodyKindsCompared: comparison.requestBodyKindsCompared,
					unreadableRequestBodies: comparison.unreadableRequestBodies,
					emitterWarnings: comparison.emitterWarnings,
					versionedSourcesNarrowed: [...comparison.versionedSourcesNarrowed].toSorted(),
					operations: comparison.operations,
					ourFailures: [...comparison.ourFailures].toSorted(),
					oracleFailures: [...comparison.oracleFailures].toSorted(),
					divergences: Object.fromEntries(Object.entries(grouped).toSorted()),
				} satisfies Baseline,
				null,
				"\t",
			)}\n`,
		);
	}
	baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
}, 600_000);

/**
 * **The second graded document version, and what it is actually for.**
 *
 * `@typespec/openapi3` accepts 3.0.0, 3.1.0 and 3.2.0, and this corpus compared against 3.1 alone
 * until now, so nothing had ever looked at what it emits at 3.2. Measured across every scenario, the
 * documents differ in exactly one place: `streaming/sse`, three operations, where the
 * `text/event-stream` response loses `schema` and gains `itemSchema`.
 *
 * **The reason to grade it is not that diff.** At 3.1 eight of the nine SSE components are
 * unreachable from `paths`, so the reachability walk excuses them and no arm ever reads them. At 3.2
 * five become reachable through `itemSchema.oneOf[].properties.data.contentSchema`, and this emitter
 * already declares all five. Grading the second version turns an existing blind spot into compared
 * pairs without the emitter changing at all.
 *
 * **The divergence set is asserted to be IDENTICAL rather than given a baseline of its own.** A
 * second copy of the baseline would drift, and would have to be re-approved for every change that
 * has nothing to do with versions. Equality says the thing actually worth saying: reading the newer
 * document finds nothing wrong that the older one did not.
 */
describe("the same corpus, against the newer document version", () => {
	it("grades the second version over a real share of the corpus", () => {
		// The floor that would catch the whole arm reading an empty directory - which is precisely what
		// the per-version output layout does to a reader that has not been told about it.
		expect(comparisonAtLater.documentsRead).toBeGreaterThanOrEqual(60);
		expect(comparisonAtLater.scenariosDifferentiated).toBe(comparison.scenariosDifferentiated);
		expect(comparisonAtLater.objectsCompared).toBeGreaterThanOrEqual(140);
	});

	it("finds no divergence the older document version does not also show", () => {
		const key = (list: readonly Divergence[]): string[] =>
			list.map((d) => `${d.kind} :: ${d.where} :: ${d.detail}`).toSorted();
		expect(key(comparisonAtLater.divergences)).toEqual(key(comparison.divergences));
	});

	it("fails and excuses exactly the same scenarios", () => {
		expect([...comparisonAtLater.ourFailures].toSorted()).toEqual(
			[...comparison.ourFailures].toSorted(),
		);
		expect([...comparisonAtLater.oracleFailures].toSorted()).toEqual(
			[...comparison.oracleFailures].toSorted(),
		);
		expect(comparisonAtLater.emitterWarnings).toEqual([]);
	});

	/**
	 * **The one measured difference, pinned in both directions.**
	 *
	 * A streamed response at 3.2 publishes `itemSchema` and no `schema`, so the three SSE bodies that
	 * 3.1 compares as `{"type": "string"}` against `z.string()` have nothing for the kind walk to read
	 * and are counted unreadable instead. Predicted before the change and confirmed: unreadable 4 -> 7,
	 * kinds 44 -> 41, with the total across both buckets unchanged at 48.
	 *
	 * **This is a gap, not a target.** The document at 3.2 says more about a stream than 3.1 does, and
	 * this emitter validates the stream as a string either way. Pinned exactly so that closing it moves
	 * a number somebody has to explain, rather than passing quietly.
	 */
	it("names the streamed bodies as stream items rather than as unreadable ones", () => {
		// 3.1 cannot express a stream, so nothing is classified this way there.
		expect(comparison.streamItemBodies).toBe(0);
		// `streaming/sse` declares three, and naming them is the point: a bare count moving by three
		// would also be satisfied by three unrelated bodies breaking while these three started working.
		expect(comparisonAtLater.streamItemBodies).toBe(3);
		/**
		 * **Unreadable does not move, which is the whole claim.** These three are not a hole in the
		 * harness; the document is describing something this emitter validates as a string, and that
		 * gap is `streamItemBodies` itself rather than a failure to read.
		 */
		expect(comparisonAtLater.unreadableResponseBodies).toBe(comparison.unreadableResponseBodies);
		expect(comparisonAtLater.responseBodyKindsCompared).toBe(
			comparison.responseBodyKindsCompared - comparisonAtLater.streamItemBodies,
		);
		// The three buckets partition one set of positions, so the total may not move.
		const total = (c: Comparison): number =>
			c.unreadableResponseBodies + c.responseBodyKindsCompared + c.streamItemBodies;
		expect(total(comparisonAtLater)).toBe(total(comparison));
	});
});

describe("the validator and the document agree, over a corpus we did not write", () => {
	it("differentiates a real share of the corpus", () => {
		// Without this the whole file passes vacuously the day discovery, compilation or the name
		// derivation quietly stops finding anything.
		expect(discoverScenarios().length).toBeGreaterThanOrEqual(65);
		expect(comparison.scenariosDifferentiated).toBeGreaterThanOrEqual(55);
		/**
		 * **Documents actually opened, which `scenariosDifferentiated` does not imply.**
		 *
		 * openapi3 moves its output into per-version subdirectories as soon as a second version is
		 * graded, and a reader left on the flat layout finds an empty list rather than an error. Both
		 * halves of that were measured: without this floor the mistake reported success, and it
		 * reported success even against a CONTROL that reinstated it, because the superseded flat file
		 * from the previous run was still on disk. `compileScenario` now empties its directory, and
		 * this is the arm that notices if the reader and the writer ever disagree about where output
		 * goes.
		 */
		expect(comparison.documentsRead).toBeGreaterThanOrEqual(60);
		expect(comparison.objectsCompared).toBeGreaterThanOrEqual(140);
		// A discriminated base is compared as a union; if none were, that whole arm proved nothing.
		expect(comparison.unionsCompared).toBeGreaterThanOrEqual(5);
		// Arrays and dictionaries are a minority of properties; 67 across the corpus + spike.
		expect(comparison.elements.compared).toBeGreaterThanOrEqual(30);
		expect(comparison.kinds.compared).toBeGreaterThanOrEqual(250);
		/**
		 * **The arm that did not exist, held open by its own floor.**
		 *
		 * The document's empty schema `{}` states that a value is unconstrained. That reading used to
		 * collapse to "unreadable" and skip, so a validator OVER-constraining an open value was
		 * invisible - measured: typing binary multipart parts as `z.string()` reddened three
		 * behavioural arms and nothing here.
		 *
		 * Without a floor the fix is one refactor away from silently reverting: a predicate that stops
		 * firing takes every one of these comparisons with it and the suite still reports agreement.
		 * Placed under the measured count so a real reduction in coverage fails rather than passes.
		 */
		/**
		 * **The route surface, held open by its own floor.** The differential iterated
		 * `components.schemas` and route COUNTS and never opened `document.paths`, so every path, query
		 * and header validator the emitter produces was graded by nothing. Two live defects
		 * were sitting there - a header validator keyed on the TypeSpec name rather than the wire name,
		 * which 400'd every conformant request, and a hyphenated path parameter that mounted an
		 * unreachable route. Without a floor, a refactor that stops resolving `app.gen.ts` takes this
		 * whole arm with it and the suite still reports agreement.
		 */
		expect(comparison.parametersCompared).toBeGreaterThanOrEqual(90);
		/**
		 * **The third axis, and the only arm here with nothing of ours between the two sides.** Zod's
		 * own serialiser against openapi3's, so a defect in a describer we wrote cannot hide a
		 * disagreement or invent one. Floored like every other counting arm: at zero it would report
		 * agreement about nothing, which is precisely how the describers went uncompared for so long.
		 */
		expect(comparison.jsonSchemaCompared).toBeGreaterThanOrEqual(200);
		/**
		 * Zod refuses to serialise a construct with no JSON Schema meaning, such as a transform. This
		 * emitter emits none, so any climb here is the arm quietly comparing less than it reports.
		 */
		expect(comparison.jsonSchemaUnserialisable).toBe(0);
		/**
		 * **The floor that turns a counted surface into a graded one.** This arm replaced a bare
		 * `contentHeadersSkipped`, which was a gap dressed as a measurement; without a floor here it
		 * would be the same gap with a different name.
		 */
		expect(comparison.contentHeaders.compared).toBeGreaterThanOrEqual(70);
		/**
		 * **The response surface, held open by its own floor.** Until this arm existed, nothing in
		 * this package compared what an operation is allowed to ANSWER with. The emitter hands
		 * `deps.respond` a list of arms and an application validates its own output against them, and
		 * the mapping from a declared status to the body that status carries had been graded by
		 * nothing - which is how status RANGES came to be dropped silently and how every failure arm
		 * came to carry the service-wide error schema regardless of what the document named.
		 *
		 * Two floors, because the arm has two halves and the cheaper one would otherwise stand in for
		 * both: `responsesCompared` says the statuses were read, `responseBodiesCompared` says a body
		 * was resolved to a declared component and checked against the arm that carries it.
		 */
		expect(comparison.responsesCompared).toBeGreaterThanOrEqual(550);
		expect(comparison.responseBodiesCompared).toBeGreaterThanOrEqual(190);
		/**
		 * **An upper bound, because this number SUPPRESSES findings.** Every other floor here guards
		 * against an arm going quiet; this one guards the opposite failure. A reachability walk that
		 * broke - a changed `$ref` prefix, an early return - would report nothing as reachable and
		 * silently excuse every component that has no validator, which is the exact defect class the
		 * arm exists to catch. Four are unreachable today; a jump means the walk stopped walking.
		 */
		expect(comparison.unreachableComponents).toBeLessThanOrEqual(6);
		expect(comparison.kinds.unconstrained).toBeGreaterThanOrEqual(10);
		expect(comparison.elements.unconstrained).toBeGreaterThanOrEqual(5);
	});

	it("compiles every scenario the baseline does not excuse", () => {
		expect([...comparison.ourFailures].toSorted()).toEqual([...baseline.ourFailures].toSorted());
	});

	it("records separately the scenarios where openapi3 itself fails", () => {
		// Not our defect and never counted as one - if these move, Microsoft changed something.
		expect([...comparison.oracleFailures].toSorted()).toEqual(
			[...baseline.oracleFailures].toSorted(),
		);
	});

	/**
	 * **This was a hand-written list, and it silently stopped covering what the harness produces.**
	 *
	 * Every arm below is generated per kind, so a kind missing from the list had **no assertion at
	 * all**: the divergences were counted, written into the baseline, and never checked by anything.
	 * `discriminator-values` was in exactly that state for a whole commit - four real defects recorded
	 * and unasserted - and `element-type` would have joined it. The failure mode is the worst kind: a
	 * green suite over a file that lists the problems.
	 *
	 * Derived from the baseline now, so a kind cannot exist in the file without an arm reading it, and
	 * `asserts every kind of divergence it can produce` closes the other direction - a kind appearing
	 * for the first time has no baseline key, so nothing above would notice it.
	 */
	const kinds = Object.keys(
		(JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline).divergences,
	).toSorted();
	for (const kind of kinds) {
		it(`agrees about ${kind}`, () => {
			const actual = comparison.divergences
				.filter((divergence) => divergence.kind === kind)
				.map((divergence) => `${divergence.where} - ${divergence.detail}`)
				.toSorted();
			const known = new Set(baseline.divergences[kind] ?? []);
			const regressions = actual.filter((line) => !known.has(line.split(" - ")[0] ?? ""));
			expect(regressions).toEqual([]);
			const fixed = [...known].filter(
				(where) => !actual.some((line) => line.startsWith(`${where} -`)),
			);
			// A baseline entry that no longer diverges is a fix that was never recorded. Deleting the
			// entry is part of the fix, or the file stops meaning anything.
			expect(fixed).toEqual([]);
		});
	}

	it("ships no compromise of its own - zero emitter warnings across the corpus", () => {
		/**
		 * **Everything else in this file measures ACCIDENTAL disagreement. This measures deliberate
		 * disagreement, which is worse**, because it is indistinguishable from correct behaviour unless
		 * somebody wrote it down - and writing it down is what makes it feel handled.
		 *
		 * For one commit this arm asserted a list of four such divergences and passed, which was the
		 * whole problem: an injected discriminator, a warning, a citation of the rule openapi3 breaks,
		 * and a validator enforcing something no contract stated. The construct is refused now, so the
		 * honest assertion is not "the declared list is unchanged" but **empty**. A warning from this
		 * emitter means it is knowingly shipping output the document does not describe; there is no
		 * quantity of that which is fine.
		 */
		expect(comparison.emitterWarnings).toEqual([]);
	});

	it("asserts EVERY kind of divergence it can produce, not a hand-kept list", () => {
		/**
		 * The arms above are generated from the baseline's keys, so a kind that has never diverged has
		 * no arm - and the first time it does, nothing would fail. This is that check: any kind the
		 * comparison produced which no arm reads is itself the defect, whatever it happens to say.
		 *
		 * Fixing one means baselining it with a named reason, which creates the key, which creates the
		 * arm. There is no way to add a divergence kind and leave it unwatched.
		 */
		const produced = [...new Set(comparison.divergences.map((divergence) => divergence.kind))];
		expect(produced.filter((kind) => !kinds.includes(kind)).toSorted()).toEqual([]);
	});

	it("agrees about every constraint keyword", () => {
		// Baseline-aware like every other arm, and for the same reason: the entries here are a real
		// defect with a fix pending - the emitter anchors `@pattern` and the document does not - and a
		// hard assertion would have to be deleted to reach green, which loses the record. The stale arm
		// makes them disappear the moment the fix lands.
		const known = new Set(
			Object.entries(baseline.divergences)
				.filter(([kind]) => kind.startsWith("constraint:"))
				.flatMap(([kind, wheres]) => wheres.map((where) => `${kind} ${where}`)),
		);
		const actual = comparison.divergences
			.filter((divergence) => divergence.kind.startsWith("constraint:"))
			.map((divergence) => ({
				key: `${divergence.kind} ${divergence.where}`,
				line: `${divergence.kind} ${divergence.where} - ${divergence.detail}`,
			}));
		const regressions = actual.filter(({ key }) => !known.has(key)).map(({ line }) => line);
		expect(regressions.toSorted()).toEqual([]);
		const fixed = [...known].filter((key) => !actual.some((entry) => entry.key === key));
		expect(fixed.toSorted()).toEqual([]);
	});

	it("mounts the operations the document declares", () => {
		/**
		 * The headline, kept as a number rather than left implicit in the per-scenario arm above.
		 *
		 * A component-by-component differential can be entirely green while the emitter mounts nothing
		 * at all - `payload/multipart` emitted `GENERATED_ROUTES = []` against seventeen declared
		 * operations and every other arm was satisfied. This is the arm that makes "the surface is
		 * covered" a claim somebody checked.
		 */
		expect(comparison.operations).toEqual(baseline.operations);
	});

	it("counts what it deliberately does NOT check, rather than staying quiet about it", () => {
		/**
		 * Two reductions this suite makes, each a number rather than a silence.
		 *
		 * **`format` is never compared.** JSON Schema 2020-12 defines it as an annotation, not an
		 * assertion, so a document carrying `format: int32` forbids nothing and a validator ignoring it
		 * is not in breach. That is a reason not to FAIL, not a reason to look away: a client generated
		 * from the document may well produce an int32-ranged type, and the count is what makes the
		 * decision available to somebody.
		 *
		 * **A versioned service is compared against its latest document only**, because one schema set
		 * is all we emit. Naming the sources keeps "we serve only the latest version" a stated
		 * limitation instead of an accident of which filename sorted last.
		 */
		expect(comparison.unenforcedFormats).toBe(baseline.unenforcedFormats);
		/**
		 * **A response body read by status but not by component.** An inline schema has no component to
		 * be named by, and a negotiated entry lists one body per media type against members that each
		 * carry their own - neither is a defect, and neither is coverage. Pinned rather than bounded,
		 * because a change in either direction means the arm is reading a different set of responses
		 * than it was.
		 *
		 * **The inline half of this used to be counted and is now COMPARED.** 76 positions named no
		 * component, so a name comparison had nothing to say about them - and an inline response schema
		 * is a real shape the emitter still has to get right. They go through the same shape walk the
		 * components do, and the number below is coverage rather than a gap.
		 */
		expect(comparison.negotiatedResponseBodies).toBe(baseline.negotiatedResponseBodies);
		expect(comparison.unreadableResponseBodies).toBe(baseline.unreadableResponseBodies);
		expect(comparison.inlineResponseBodiesCompared).toBeGreaterThanOrEqual(
			baseline.inlineResponseBodiesCompared,
		);
		expect(comparison.responseBodyKindsCompared).toBeGreaterThanOrEqual(
			baseline.responseBodyKindsCompared,
		);
		/**
		 * **The request body had no arm at all until now, so it gets a floor like every other
		 * counting arm.** An arm without one reports agreement about nothing the day its predicate
		 * stops firing - which is how the content-header arm compared zero positions and passed.
		 */
		expect(comparison.requestBodiesCompared).toBeGreaterThanOrEqual(baseline.requestBodiesCompared);
		expect(comparison.requestBodyKindsCompared).toBeGreaterThanOrEqual(
			baseline.requestBodyKindsCompared,
		);
		expect(comparison.unreadableRequestBodies).toBe(baseline.unreadableRequestBodies);
		expect([...comparison.versionedSourcesNarrowed].toSorted()).toEqual(
			[...baseline.versionedSourcesNarrowed].toSorted(),
		);
	});

	it("actually READ constraints, on both sides, before saying they agree", () => {
		/**
		 * **The arm above passed for a week's worth of work while measuring nothing.**
		 *
		 * Across 230 properties of the corpus it extracted **zero** constraints from either artefact -
		 * `http-specs` tests protocol behaviour and declares none, and its only `@minValue`/`@maxValue`
		 * sit on a `@statusCode`, which is metadata and never reaches a body. "No divergences" was
		 * true and worthless.
		 *
		 * The previous guard - skips fewer than objects - could not have caught it, because it says
		 * nothing about whether a single constraint was ever read. This one names the quantity the arm
		 * depends on. The material comes from the depth fixtures; if they stop supplying it, this fails rather
		 * than the comparison quietly going hollow.
		 */
		expect(comparison.constraintsSeen.document).toBeGreaterThanOrEqual(10);
		expect(comparison.constraintsSeen.validator).toBeGreaterThanOrEqual(10);
		expect(comparison.refConstraintSkips).toBeLessThan(comparison.objectsCompared);
	});
});
