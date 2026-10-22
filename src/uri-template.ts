import { literal } from "./literal.js";

/**
 * RFC 6570 URI templates, read for what a server has to mount and what it has to decode.
 *
 * **`HttpOperation.uriTemplate`, never `HttpOperation.path`.** `path` drops every operator, so
 * `array{.param*}`, `array{;param}` and `array{/param}` all become `array{param}`, and a route mounted
 * from it answers 404 to the URL its own contract declares. Measured on `@typespec/http-specs`
 * `routes`: 30 of its mock server's URIs, plus the query-continuation six.
 *
 * `parseUriTemplate` is copied from `@typespec/http` 1.16.0 (`dist/src/uri-template.js`, MIT), which
 * implements it but does not export it, so the template is split exactly as the library that built
 * it splits it.
 */

const OPERATORS = ["+", "#", ".", "/", ";", "?", "&"] as const;
type Operator = (typeof OPERATORS)[number];

interface TemplateExpression {
	readonly name: string;
	readonly operator: Operator | undefined;
	readonly explode: boolean;
}

function parseUriTemplate(template: string): (string | TemplateExpression)[] {
	const parts: (string | TemplateExpression)[] = [];
	for (const [, rawExpression, literal] of template.matchAll(/\{([^{}]+)\}|([^{}]+)/g)) {
		if (rawExpression === undefined) {
			parts.push(literal ?? "");
			continue;
		}
		let expression = rawExpression;
		let operator: Operator | undefined;
		const first = expression[0] as Operator | undefined;
		if (first !== undefined && OPERATORS.includes(first)) {
			operator = first;
			expression = expression.slice(1);
		}
		for (const item of expression.split(",")) {
			const match = /([^:*]*)(?::(\d+)|(\*))?/.exec(item);
			parts.push({ name: match?.[1] ?? item, operator, explode: match?.[3] !== undefined });
		}
	}
	return parts;
}

/**
 * One `/`-delimited segment of a route, as a server has to mount it.
 *
 * - `literal`: fixed text.
 * - `expression`: exactly one parameter, with the literal text written before and after it inside
 *   the same segment, its RFC 6570 operator (`""` for simple expansion) and whether it explodes. A
 *   `/` expression opens a segment of its own, and one that explodes spans every segment after it.
 * - `unsupported`: a segment holding more than one expression, which no segment router can split.
 */
export type EmittedPathSegment =
	| { readonly kind: "literal"; readonly text: string }
	| {
			readonly kind: "expression";
			/** The parameter's WIRE name, the one `pathSchema` keys on. */
			readonly parameter: string;
			readonly prefix: string;
			readonly suffix: string;
			readonly operator: "" | "+" | "#" | "." | "/" | ";";
			readonly explode: boolean;
			readonly optional: boolean;
			readonly reserved: boolean;
	  }
	| { readonly kind: "unsupported"; readonly text: string };

/** What the path segments need to know about each path parameter the operation resolves. */
export interface PathParameterFacts {
	readonly name: string;
	readonly optional: boolean;
	readonly reserved: boolean;
}

/** A route template as the segments a server mounts, and the literal query pairs it carries. */
export function routeTemplateOf(
	uriTemplate: string,
	parameters: readonly PathParameterFacts[],
): {
	readonly segments: readonly EmittedPathSegment[];
	readonly literalQuery: readonly (readonly [string, string])[];
} {
	const facts = new Map(parameters.map((parameter) => [parameter.name, parameter]));
	const raw: (string | TemplateExpression)[][] = [];
	const literalQuery: [string, string][] = [];
	let current: (string | TemplateExpression)[] | undefined;
	let inQuery = false;
	const open = () => {
		current = [];
		raw.push(current);
		return current;
	};
	for (const part of parseUriTemplate(uriTemplate)) {
		if (typeof part === "string") {
			let text = part;
			if (inQuery) {
				literalQuery.push(...pairsOf(text));
				continue;
			}
			if (text.includes("?")) {
				inQuery = true;
				literalQuery.push(...pairsOf(text.slice(text.indexOf("?") + 1)));
				text = text.slice(0, text.indexOf("?"));
			}
			text.split("/").forEach((piece, index) => {
				const target = index === 0 ? (current ?? (piece === "" ? undefined : open())) : open();
				if (piece !== "" && target !== undefined) target.push(piece);
			});
			continue;
		}
		// `{?x}` and `{&x}` are query parameters, which a query validator reads; they are not path.
		if (part.operator === "?" || part.operator === "&") continue;
		if (part.operator === "/") open().push(part);
		else (current ?? open()).push(part);
	}
	const segments = raw
		.filter((parts) => parts.length > 0)
		.map((parts): EmittedPathSegment => {
			const expressions = parts.filter(
				(part): part is TemplateExpression => typeof part !== "string",
			);
			const text = (from: readonly (string | TemplateExpression)[]) =>
				from.filter((part): part is string => typeof part === "string").join("");
			const [only] = expressions;
			if (only === undefined) return { kind: "literal", text: text(parts) };
			if (expressions.length > 1) {
				return {
					kind: "unsupported",
					text: parts
						.map((part) =>
							typeof part === "string" ? part : `{${part.operator ?? ""}${part.name}}`,
						)
						.join(""),
				};
			}
			const at = parts.indexOf(only);
			const fact = facts.get(only.name);
			return {
				kind: "expression",
				parameter: only.name,
				prefix: text(parts.slice(0, at)),
				suffix: text(parts.slice(at + 1)),
				operator: only.operator === "?" || only.operator === "&" ? "" : (only.operator ?? ""),
				explode: only.explode,
				optional: fact?.optional ?? false,
				reserved: only.operator === "+" || only.operator === "#" || fact?.reserved === true,
			};
		});
	return { segments, literalQuery };
}

/** `a=1&b=2` -> the pairs it spells; a piece with no `=` is a name with an empty value. */
function pairsOf(text: string): [string, string][] {
	return text
		.split("&")
		.filter((piece) => piece !== "")
		.map((piece) => {
			const at = piece.indexOf("=");
			return at === -1 ? [piece, ""] : [piece.slice(0, at), piece.slice(at + 1)];
		});
}

/** What a value decodes into: one value, a list, or name/value pairs (a record or a model). */
export type ExpansionShape = "scalar" | "list" | "record";

/**
 * What a decoder reads an expansion as: one of those, or `any` - a value of any type, which is the
 * shape its expansion spells. See {@link URI_EXPANSION_SOURCE}.
 */
export type DecodedShape = ExpansionShape | "any";

/**
 * Whether a path value needs decoding at all. **An ordinary whole-segment parameter does not**, and
 * leaving its validator untouched keeps every spec without an RFC 6570 form byte-identical.
 */
export function needsExpansionDecoding(
	segment: Extract<EmittedPathSegment, { kind: "expression" }>,
	shape: ExpansionShape,
): boolean {
	return (
		segment.prefix !== "" ||
		segment.suffix !== "" ||
		segment.operator === "." ||
		segment.operator === ";" ||
		shape !== "scalar"
	);
}

/**
 * The call that decodes one expansion, as a `z.preprocess` argument. The decoder itself is
 * {@link URI_EXPANSION_SOURCE}, declared once in `schemas.gen.ts` when something calls it.
 */
export function uriExpansionCall(spec: {
	readonly prefix: string;
	readonly suffix: string;
	readonly operator: string;
	readonly name: string;
	readonly explode: boolean;
	readonly shape: DecodedShape;
	readonly readers: ValueReaders;
}): string {
	return `(raw, ctx) => uriExpansion(raw, ctx, { prefix: ${literal(spec.prefix)}, suffix: ${literal(spec.suffix)}, operator: ${literal(spec.operator)}, name: ${literal(spec.name)}, explode: ${spec.explode}, shape: ${literal(spec.shape)}, ${readersOf(spec.readers)} })`;
}

/**
 * **The schemas a record's or a model's values are read against**, as Zod expressions: one for every
 * value of a record, or one per key of a model. `null` where no value can be anything but text, so
 * a service whose parameters are all strings declares no reader.
 */
export interface ValueReaders {
	readonly values: string | null;
	readonly fields: Readonly<Record<string, string>> | null;
	/**
	 * **A discriminated base's readers per subtype**, chosen by the value's own discriminator: a header
	 * `Pet` carrying `kind,cat,x,5` reads `x` as `Cat` declares it, a string, where `Dog`'s `x` is a
	 * number. Read by one table for every subtype, the first subtype's reading won.
	 */
	readonly by?: {
		readonly property: string;
		readonly readers: Readonly<Record<string, ValueReaders>>;
	};
}

/**
 * A reader for a list: a lone value boxed into the list it stands for, each element read against the
 * element's schema - `?tags=1&tags=2` gathered as `["1", "2"]`, and `?tags=1` as `["1"]`.
 */
export function eachReader(
	element: string | readonly string[],
	one?: string,
	whole?: string,
): string {
	const each =
		typeof element === "string"
			? element
			: element.length === 1
				? (element[0] as string)
				: `[${element.join(", ")}]`;
	return `{ each: ${each}${one === undefined ? "" : `, one: ${one}`}${whole === undefined ? "" : `, whole: ${whole}`} }`;
}

export const NO_READERS: ValueReaders = { values: null, fields: null };

function readersOf(readers: ValueReaders): string {
	const by = readers.by;
	return by === undefined
		? tableOf(readers)
		: `${tableOf(readers)}, by: { property: ${literal(by.property)}, readers: { ${Object.entries(
				by.readers,
			)
				.map(([value, each]) => `[${literal(value)}]: { ${tableOf(each)} }`)
				.join(", ")} } }`;
}

/** One table of readers: every value's, and each key's. */
function tableOf(readers: ValueReaders): string {
	const fields =
		readers.fields === null
			? "null"
			: // Computed keys, so `__proto__` is a key like any other and not the object's prototype.
				`{ ${Object.entries(readers.fields)
					.map(([key, schema]) => `[${literal(key)}]: ${schema}`)
					.join(", ")} }`;
	return `values: ${readers.values ?? "null"}, fields: ${fields}`;
}

/**
 * **Wire text read as the JSON value it spells, as its schema says it is.** A path, query, header,
 * cookie or form value is always text, and the document's schema describes it once read: `"5"` is
 * `5` where the schema is `int32`, `true` where it is `boolean`, and stays `"5"` where it is a
 * string. The text is tried as a number, then as a boolean, then as itself, and the first the schema
 * accepts is the value - so `limit: int32 | "all"` reads `"5"` as `5` and `"all"` as `"all"`, and
 * `int32 | boolean` reads both. Where none is accepted the first reading is handed on, to fail with
 * the error that reading earns.
 *
 * **A number is text in JSON's number grammar, and nothing looser.** Read by `Number()`, `"0x10"`,
 * `"007"` and `" 5"` were numbers: `int32` accepted text no JSON number is written as, and `"007" |
 * int32` turned the `"007"` it accepts into `7`.
 *
 * Read by a kind instead - number, boolean or text, decided from the type - a numeric enum, a union
 * of a number and a boolean, and a number beside a string literal were never read at all.
 */
export const WIRE_READ_SOURCE = `
/** Wire text as the JSON value it spells that the schema accepts: a number, a boolean, or the text. */
function wireRead(raw: unknown, schema: z.ZodType): unknown {
	if (typeof raw !== "string") return raw;
	const readings: unknown[] = [];
	if (/^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?$/.test(raw) && Number.isFinite(Number(raw))) {
		readings.push(Number(raw));
	}
	if (raw === "true" || raw === "false") readings.push(raw === "true");
	for (const reading of [...readings, raw]) if (schema.safeParse(reading).success) return reading;
	return readings[0] ?? raw;
}
`;

/**
 * How one value is read: against a schema, or as a list boxed and read element by element - a
 * record's or a model's value, through the decoders below, and a multipart text part that may be one
 * value or several. Declared beside its callers only.
 */
export const WIRE_READ_AS_SOURCE = `
/** How one value is read: against a schema, or as a list of values each read against one. */
type WireReader =
	| z.ZodType
	| { readonly each: z.ZodType | readonly z.ZodType[]; readonly one?: z.ZodType; readonly whole?: z.ZodType };

/** A value read against its reader: one value, or a list of them. */
function wireReadAs(value: unknown, reader: WireReader | null | undefined): unknown {
	if (reader === null || reader === undefined) return value;
	if ("each" in reader) {
		const accepted = (read: unknown): boolean => reader.whole === undefined || reader.whole.safeParse(read).success;
		// A value that may be one value or a list of them: a lone occurrence is the one value, where that is one.
		if (!Array.isArray(value) && reader.one !== undefined) {
			const one = wireRead(value, reader.one);
			if (accepted(one)) return one;
		}
		// A list read as the first of its list members' elements the whole accepts: \`int32[] | string[]\`.
		const items: unknown[] = Array.isArray(value) ? value : [value];
		const lists: readonly z.ZodType[] = Array.isArray(reader.each) ? reader.each : [reader.each as z.ZodType];
		const readings = lists.map((each) => items.map((item) => wireRead(item, each)));
		return readings.find(accepted) ?? readings[0];
	}
	return wireRead(value, reader);
}
`;

/**
 * How the RFC 6570 decoders read a record's or a model's values: by the reader for the key, looked
 * up as the table's OWN property - a key named `constructor` found `Object` on the prototype and
 * handed it to `wireRead`, which threw - each read by {@link WIRE_READ_AS_SOURCE}. Declared beside
 * those decoders only, which are its only callers.
 */
export const WIRE_READERS_SOURCE = `
/** A record's or a model's readers: every value's, each key's, and a discriminated base's per subtype. */
type WireReaders = {
	readonly values: WireReader | null;
	readonly fields: globalThis.Readonly<globalThis.Record<string, WireReader>> | null;
	readonly by?: { readonly property: string; readonly readers: globalThis.Readonly<globalThis.Record<string, WireReaders>> };
};

/** The readers for an object whose discriminator reads \`kind\`: the subtype it names, else the base's. */
function wireReadersOf(spec: WireReaders, kind: unknown): WireReaders {
	if (spec.by === undefined || typeof kind !== "string") return spec;
	return Object.prototype.hasOwnProperty.call(spec.by.readers, kind) ? (spec.by.readers[kind] ?? spec) : spec;
}

/** The value an object's discriminator holds, as its own property. */
function wireKindOf(spec: WireReaders, raw: object): unknown {
	return spec.by !== undefined && Object.prototype.hasOwnProperty.call(raw, spec.by.property)
		? (raw as globalThis.Record<string, unknown>)[spec.by.property]
		: undefined;
}

/** A model's reader for a key it declares, read as its own property only, or a record's for any. */
function wireReaderOf(spec: WireReaders, key: string): WireReader | null {
	const own = spec.fields !== null && Object.prototype.hasOwnProperty.call(spec.fields, key);
	return (own ? spec.fields?.[key] : spec.values) ?? null;
}
`;

/**
 * **A gathered object read as one member of a union of models reads it.** A form-exploded query
 * typed `A | B` arrives as one set of keys, gathered once under the parameter's name; each member then
 * reads the values as its own properties say. Gathered once per member, the last member's gatherer
 * claimed the name and every other member's keys stayed unread, so `?kind=a&x=1` was refused.
 * Copied key by key as own properties, so a key named `__proto__` is a key and not the prototype.
 */
export const WIRE_READ_OBJECT_SOURCE = `
/** A gathered object's values read against one member's readers. */
function wireReadObject(raw: unknown, spec: WireReaders): unknown {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
	const readers = wireReadersOf(spec, wireKindOf(spec, raw));
	const read: globalThis.Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		Object.defineProperty(read, key, { value: wireReadAs(value, wireReaderOf(readers, key)), enumerable: true, writable: true, configurable: true });
	}
	return read;
}
`;

/** The call that reads a gathered object as one member of a union - see {@link WIRE_READ_OBJECT_SOURCE}. */
export function wireReadObjectCall(readers: ValueReaders): string {
	return `(raw) => wireReadObject(raw, { ${readersOf(readers)} })`;
}

/**
 * **RFC 6570 section 3.2, run backwards.** A router hands over the text of the segment an expression
 * sits in (or, for an exploding `/` expression, every segment after its literal), and this undoes
 * the expansion: the literal around it, the operator's leading character, a matrix parameter's
 * `name=`, then the joiner the operator and explode modifier chose.
 *
 * Text that is not the expansion the route declares is REFUSED with an issue of its own, not passed
 * on: a string parameter's schema would accept `primitive;other=a` as the string it is, so leaving
 * the refusal to the schema admitted a request the route does not match. A list's element values
 * are decoded by the element decoder inside, as a query list's are; a record's values are decoded
 * here, because no schema expression reaches them one by one.
 *
 * **A value of any type is read as the shape its expansion spells** (`any`): `unknown`, a scalar
 * with no standard base, or a union holding one, which openapi3 publishes as `{}` or with `{}` among
 * its members. Under `{;v*}` a scalar is exactly one `v=` part, so `;v=1;v=2` - `[1, 2]` in the
 * document - and `;a=1;b=2` - `{ a: 1, b: 2 }` - had no reading, and were refused as not the
 * expansion the route declares. Several parts all named `v` are a list, any other an object, each
 * value read as the text it spells; anywhere else, and as one `v=` part, every expansion is also a
 * scalar's, which is the reading taken first, as `wireRead` takes the number first.
 */
export const URI_EXPANSION_SOURCE = `
/** RFC 6570 section 3.2 in reverse: one expression's expansion, decoded into the value it expanded. */
function uriExpansion(
	raw: unknown,
	ctx: { addIssue(issue: { code: "custom"; message: string }): void },
	spec: WireReaders & {
		readonly prefix: string;
		readonly suffix: string;
		readonly operator: string;
		readonly name: string;
		readonly explode: boolean;
		readonly shape: "scalar" | "list" | "record" | "any";
	},
): unknown {
	if (typeof raw !== "string") return raw;
	const refuse = (): unknown => {
		ctx.addIssue({ code: "custom", message: \`Not the expansion of {\${spec.operator}\${spec.name}\${spec.explode ? "*" : ""}} this route declares\` });
		return z.NEVER;
	};
	if (raw.length < spec.prefix.length + spec.suffix.length) return refuse();
	if (!raw.startsWith(spec.prefix) || !raw.endsWith(spec.suffix)) return refuse();
	let text = raw.slice(spec.prefix.length, raw.length - spec.suffix.length);
	if (spec.operator === "." || spec.operator === ";") {
		if (!text.startsWith(spec.operator)) return refuse();
		text = text.slice(1);
	}
	const parts = text.split(";");
	const own = parts.filter((part) => part === spec.name || part.startsWith(\`\${spec.name}=\`)).length;
	// A value of any type is the shape its expansion spells: only \`{;v*}\` spells a list or an object no scalar does.
	const shape =
		spec.shape !== "any"
			? spec.shape
			: spec.operator !== ";" || !spec.explode || text === "" || (parts.length === 1 && own === 1)
				? "scalar"
				: own === parts.length
					? "list"
					: "record";
	if (spec.operator === ";" && !(shape === "record" && spec.explode)) {
		const named = parts.map((part) => (part === spec.name ? "" : part.startsWith(\`\${spec.name}=\`) ? part.slice(spec.name.length + 1) : undefined));
		if (named.some((part) => part === undefined)) return refuse();
		if (shape === "list" && spec.explode) {
			// Read here where no element decoder runs after: the elements of a value of any type.
			return spec.shape === "any" ? named.map((item) => wireReadAs(item, spec.values)) : named;
		}
		if (named.length !== 1) return refuse();
		text = named[0] ?? "";
	}
	if (shape === "scalar") return text;
	const joiner = spec.explode && (spec.operator === "." || spec.operator === "/" || spec.operator === ";") ? spec.operator : ",";
	if (shape === "list") return text === "" ? [] : text.split(joiner);
	const entries: [string, string][] = [];
	if (spec.explode) {
		for (const piece of text === "" ? [] : text.split(joiner)) {
			const at = piece.indexOf("=");
			const last = entries[entries.length - 1];
			// A value holding the joiner, which the expansion leaves as it is - \`a=1.5\` under \`{.r*}\` - goes on.
			if (at === -1 && last !== undefined) last[1] += \`\${joiner}\${piece}\`;
			else if (at === -1) return refuse();
			else entries.push([piece.slice(0, at), piece.slice(at + 1)]);
		}
	} else {
		const items = text === "" ? [] : text.split(",");
		if (items.length % 2 !== 0) return refuse();
		for (let index = 0; index < items.length; index += 2) {
			entries.push([items[index] ?? "", items[index + 1] ?? ""]);
		}
	}
	const readers = wireReadersOf(spec, wireKindOf(spec, Object.fromEntries(entries)));
	return Object.fromEntries(entries.map(([key, item]) => [key, wireReadAs(item, wireReaderOf(readers, key))]));
}
`;

/**
 * The call that gathers a form-exploded record or model back under its parameter name. The
 * gatherer itself is {@link EXPLODED_QUERY_SOURCE}.
 */
export function explodedQueryCall(spec: {
	readonly name: string;
	/** For a record, every OTHER query parameter's wire name; its own keys are whatever is left. */
	readonly others: readonly string[];
	/** For a model, its own properties' wire names; `undefined` for a record. */
	readonly keys: readonly string[] | undefined;
	/**
	 * Whether the parameter may also be sent as itself - a list or a scalar beside its records and
	 * models - so what arrived under its name is kept for those, see {@link WIRE_ITSELF_SOURCE}.
	 */
	readonly itself: boolean;
	readonly readers: ValueReaders;
}): string {
	return `(raw) => explodedQuery(raw, { name: ${literal(spec.name)}, others: ${literal(spec.others)}, keys: ${literal(spec.keys ?? null)}, itself: ${spec.itself}, ${readersOf(spec.readers)} })`;
}

/**
 * **`{?param*}` over a record or a model expands to the object's own keys**, `?a=1&b=2` and
 * `?field=status&value=active`, so there is no `param` key for a query validator to find. This
 * gathers those keys back under the parameter's name before the query object is validated: a model
 * takes exactly its declared properties, a record every key no other query parameter claims.
 *
 * **The parameter's own name is a key like any other, and only that.** `?f=5` beside `f?: F`, where
 * `F` declares no `f`, is no key of the object and no other parameter's: the document reads it as a
 * parameter it does not declare, and accepts it. Left under the name, it reached the model's schema
 * as the string `"5"`, and was refused, where `?zzz=5` was accepted. Only a parameter that may also be
 * sent as itself keeps it - see {@link WIRE_ITSELF_SOURCE}.
 */
export const EXPLODED_QUERY_SOURCE = `
/** Each object a gatherer made for a parameter that may also be sent as itself, and what was: one value, or none. */
const wireSentAsItself = new WeakMap<object, readonly unknown[]>();

/** RFC 6570 form expansion of an exploded record or model, gathered back under its parameter. */
function explodedQuery(
	raw: unknown,
	spec: WireReaders & {
		readonly name: string;
		readonly others: readonly string[];
		readonly keys: readonly string[] | null;
		readonly itself: boolean;
	},
): unknown {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
	const readers = wireReadersOf(spec, wireKindOf(spec, raw));
	const gathered: globalThis.Record<string, unknown> = {};
	const rest: globalThis.Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		// Already gathered only where an OBJECT sits under the name: a query value from the wire is a
		// string or a list of them, and \`{ param: 0 }\` expands to \`?param=0\`.
		if (key === spec.name && value !== null && typeof value === "object" && !Array.isArray(value)) return raw;
		/**
		 * Left in place as well, for every other object gathered from the same query: \`f: F1\` and
		 * \`g: F2\` both declaring \`a\` each read \`?a=1\`, as the document reads it, where the first
		 * gatherer took \`a\` and the second refused a missing \`g\`. The query object strips it after.
		 */
		rest[key] = value;
		// A key another query parameter is named is that parameter's, the reading the document takes.
		const own = !spec.others.includes(key) && (spec.keys === null || spec.keys.includes(key));
		if (own) gathered[key] = wireReadAs(value, wireReaderOf(readers, key));
	}
	const sent = Object.prototype.hasOwnProperty.call(raw, spec.name);
	if (Object.keys(gathered).length > 0) {
		if (spec.itself) wireSentAsItself.set(gathered, sent ? [(raw as globalThis.Record<string, unknown>)[spec.name]] : []);
		return { ...rest, [spec.name]: gathered };
	}
	// Nothing gathered: the name sent alone is the parameter itself, where it may be, or a key nothing declares.
	if (!sent || spec.itself) return raw;
	delete rest[spec.name];
	return rest;
}
`;

/** The call that hands a list or a scalar form the value its parameter was sent as itself. */
export function wireItselfCall(): string {
	return `(raw, ctx) => wireItself(raw, ctx)`;
}

/**
 * **A parameter that may be an object or a list is read both ways from one query.** `x?: int32[] |
 * Record<int32>` exploded is `?x=1&x=2` as the list and `?a=1&b=2` as the record - and `?x=5` as
 * either, since `{ x: 5 }` expands to it too. The record's gatherer takes every key, the parameter's
 * own name included, so the list member was handed `{ x: ["1", "2"] }` and refused it: `?x=1&x=2`,
 * `[1, 2]` in the document, was refused for every such union, and `?x=007`, `["007"]`, for
 * `string[] | Record<int32>`. The gatherer now records what arrived under the name beside the object
 * it made, and each member that is not an object reads that, while each that is reads the object -
 * so the union's first member the value satisfies is its reading, as everywhere else.
 *
 * **Only an object the gatherer made carries it.** One a caller built - the value already gathered,
 * or `queryFields` given structured input - is the object it is, and a member that is not an object
 * refuses it as before; the gatherer's own object, with nothing sent under the name, is refused here.
 */
export const WIRE_ITSELF_SOURCE = `
/** What a parameter was sent as itself, out of the object its gatherer made: refused where it was not. */
function wireItself(raw: unknown, ctx: { addIssue(issue: { code: "custom"; message: string }): void }): unknown {
	if (raw === null || typeof raw !== "object") return raw;
	const sent = wireSentAsItself.get(raw);
	if (sent === undefined) return raw;
	if (sent.length === 0) {
		ctx.addIssue({ code: "custom", message: "Sent as an object's keys, not as a value of its own" });
		return z.NEVER;
	}
	return sent[0];
}
`;
