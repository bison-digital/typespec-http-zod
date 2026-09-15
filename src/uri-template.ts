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
	readonly shape: ExpansionShape;
	readonly values: "number" | "boolean" | "";
}): string {
	return `(raw, ctx) => uriExpansion(raw, ctx, { prefix: ${JSON.stringify(spec.prefix)}, suffix: ${JSON.stringify(spec.suffix)}, operator: ${JSON.stringify(spec.operator)}, name: ${JSON.stringify(spec.name)}, explode: ${spec.explode}, shape: ${JSON.stringify(spec.shape)}, values: ${JSON.stringify(spec.values)} })`;
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
 */
export const URI_EXPANSION_SOURCE = `
/** RFC 6570 section 3.2 in reverse: one expression's expansion, decoded into the value it expanded. */
function uriExpansion(
	raw: unknown,
	ctx: { addIssue(issue: { code: "custom"; message: string }): void },
	spec: {
		readonly prefix: string;
		readonly suffix: string;
		readonly operator: string;
		readonly name: string;
		readonly explode: boolean;
		readonly shape: "scalar" | "list" | "record";
		readonly values: "number" | "boolean" | "";
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
	if (spec.operator === ";" && !(spec.shape === "record" && spec.explode)) {
		const named = text
			.split(";")
			.map((part) => (part === spec.name ? "" : part.startsWith(\`\${spec.name}=\`) ? part.slice(spec.name.length + 1) : undefined));
		if (named.some((part) => part === undefined)) return refuse();
		if (spec.shape === "list" && spec.explode) return named;
		if (named.length !== 1) return refuse();
		text = named[0] ?? "";
	}
	if (spec.shape === "scalar") return text;
	const joiner = spec.explode && (spec.operator === "." || spec.operator === "/" || spec.operator === ";") ? spec.operator : ",";
	if (spec.shape === "list") return text === "" ? [] : text.split(joiner);
	const value = (item: string): unknown =>
		spec.values === "number" && item.trim() !== "" && Number.isFinite(Number(item))
			? Number(item)
			: spec.values === "boolean" && (item === "true" || item === "false")
				? item === "true"
				: item;
	const entries: [string, unknown][] = [];
	if (spec.explode) {
		for (const pair of text === "" ? [] : text.split(joiner)) {
			const at = pair.indexOf("=");
			if (at === -1) return refuse();
			entries.push([pair.slice(0, at), value(pair.slice(at + 1))]);
		}
	} else {
		const items = text === "" ? [] : text.split(",");
		if (items.length % 2 !== 0) return refuse();
		for (let index = 0; index < items.length; index += 2) {
			entries.push([items[index] ?? "", value(items[index + 1] ?? "")]);
		}
	}
	return Object.fromEntries(entries);
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
	readonly numbers: readonly string[];
	readonly booleans: readonly string[];
	/** For a record, how every value decodes. */
	readonly values: "number" | "boolean" | "";
}): string {
	return `(raw) => explodedQuery(raw, { name: ${JSON.stringify(spec.name)}, others: ${JSON.stringify(spec.others)}, keys: ${JSON.stringify(spec.keys ?? null)}, numbers: ${JSON.stringify(spec.numbers)}, booleans: ${JSON.stringify(spec.booleans)}, values: ${JSON.stringify(spec.values)} })`;
}

/**
 * **`{?param*}` over a record or a model expands to the object's own keys**, `?a=1&b=2` and
 * `?field=status&value=active`, so there is no `param` key for a query validator to find. This
 * gathers those keys back under the parameter's name before the query object is validated: a model
 * takes exactly its declared properties, a record every key no other query parameter claims.
 */
export const EXPLODED_QUERY_SOURCE = `
/** RFC 6570 form expansion of an exploded record or model, gathered back under its parameter. */
function explodedQuery(
	raw: unknown,
	spec: {
		readonly name: string;
		readonly others: readonly string[];
		readonly keys: readonly string[] | null;
		readonly numbers: readonly string[];
		readonly booleans: readonly string[];
		readonly values: "number" | "boolean" | "";
	},
): unknown {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw) || spec.name in raw) return raw;
	const gathered: Record<string, unknown> = {};
	const rest: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		const own = spec.keys === null ? !spec.others.includes(key) : spec.keys.includes(key);
		if (!own) {
			rest[key] = value;
			continue;
		}
		const kind = spec.values !== "" ? spec.values : spec.numbers.includes(key) ? "number" : spec.booleans.includes(key) ? "boolean" : "";
		gathered[key] =
			typeof value !== "string"
				? value
				: kind === "number" && value.trim() !== "" && Number.isFinite(Number(value))
					? Number(value)
					: kind === "boolean" && (value === "true" || value === "false")
						? value === "true"
						: value;
	}
	return Object.keys(gathered).length === 0 ? raw : { ...rest, [spec.name]: gathered };
}
`;
