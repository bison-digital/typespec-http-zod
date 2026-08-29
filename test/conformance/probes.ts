/**
 * **Values that sit on the boundary of a document keyword, so a verdict can be compared.**
 *
 * The differential compares the emitted validator against the document as two DESCRIPTIONS - the
 * shape describers, and `z.toJSONSchema()` beside the document. Both can report perfect agreement
 * about a schema that answers differently the moment a value reaches it, because a keyword and its
 * SEMANTICS are two facts and only the first is written down. Measured: `maxLength: 5` and `.max(5)`
 * are the same keyword and the same number, and on zod 4.4.3 they disagreed about five emoji.
 *
 * So this file builds values, and `behaviour.test.ts` asks Ajv and Zod the same question about each.
 *
 * **Every probe names the keyword it exercises**, so a disagreement reports which rule the two
 * implementations read differently rather than only that they differ.
 */

/** A JSON Schema object as the document publishes it. Deliberately loose - this reads, never writes. */
export type Schema = Record<string, unknown>;

export interface Probe {
	/** The document keyword this value sits on the boundary of. */
	readonly keyword: string;
	/** What the value is, for a failure message that says something. */
	readonly why: string;
	readonly value: unknown;
}

/** Resolves `#/components/schemas/Foo` against the document the probes came from. */
export type Resolve = (ref: string) => Schema | undefined;

/**
 * **One astral code point, written as an escape so the source stays ASCII.**
 *
 * `portability.test.ts` requires every tracked file to be ASCII, which is why no fixture in this
 * repository had ever carried a character outside the BMP - and why the one class of length defect
 * that only astral input can expose went unseen. The escape is ASCII; the value is not.
 */
const ASTRAL = "\u{1F600}";

/** JSON Schema counts a string's length in CODE POINTS, which is not `String.prototype.length`. */
const astral = (codePoints: number): string => ASTRAL.repeat(Math.max(0, codePoints));
const ascii = (codePoints: number): string => "a".repeat(Math.max(0, codePoints));

/**
 * **A conformant value for each format this emitter enforces as a DECLARED TYPE.**
 *
 * `format` is an annotation under JSON Schema 2020-12, so Ajv is run without `ajv-formats` and
 * ignores it - which is also this emitter's stated position on an `@format` ANNOTATION. But a
 * DECLARED scalar is a claim about what the value IS, so `utcDateTime` emits
 * `z.iso.datetime({ offset: true })` and the validator does check it.
 *
 * Without a conformant value here, every probe on such a property would disagree for a reason that
 * is not a defect, and the oracle would need an exception set - a place for real divergences to hide.
 * Generating a value the document's own `format` describes removes the asymmetry instead of excusing
 * it. The checks themselves are graded by `test/formats/formats.test.ts`, which pins what each
 * declared scalar emits, and by `acceptance.test.ts`, which runs values through them.
 */
const FORMAT_INSTANCES: Readonly<Record<string, string>> = {
	"date-time": "2026-01-01T00:00:00Z",
	date: "2026-01-01",
	time: "00:00:00",
	duration: "PT1S",
	uri: "https://example.com",
};

/**
 * **A string the pattern accepts, found by ASKING the pattern rather than by reasoning about it.**
 *
 * Generating a string from an arbitrary regex is a solved-in-theory, painful-in-practice problem, and
 * one this file does not need: a probe only needs SOME conformant value. So a short list of shapes is
 * offered to the pattern itself, and the first it accepts is used. There is no guessing - the regex is
 * the oracle for its own candidates - and where none match, `undefined` propagates and the component
 * is counted as unbuildable rather than probed with a value that means nothing.
 *
 * This matters more than it looks: a component is unbuildable if ANY required property is, so one
 * unsatisfiable pattern used to take every other keyword on the model with it. `StringBounds` declares
 * `@minLength`/`@maxLength` beside a `@pattern`, and the pattern alone suppressed the only `maxLength`
 * probes in the corpus - which is exactly the keyword this oracle exists to grade.
 */
const PATTERN_CANDIDATES = [
	"a",
	"ab",
	"abc",
	"a1",
	"a-b",
	"a_b",
	"1",
	"123",
	"a.b",
	"a/b",
	"A",
	"Abc",
	"a b",
	"",
];

/**
 * **A sample drawn FROM the expression, for the patterns a fixed list will never hit.**
 *
 * `^[A-Z]{2}-\d{4}$` is an ordinary thing for a spec to declare and no list of stock strings
 * contains a match for it. So the expression is walked and one member of it is emitted: literals as
 * themselves, a class as its first member, a quantifier as its minimum (at least one).
 *
 * **Correctness does not rest on this being a complete regex engine, because the result is checked
 * against the expression before it is used.** Alternation, groups and backreferences are declined
 * rather than approximated - a wrong sample is caught by {@link satisfying} and the component is
 * counted as unbuildable, which is a visible number rather than a silent bad value.
 */
function sample(pattern: string): string | undefined {
	const body = pattern.replace(/^\^/, "").replace(/\$$/, "");
	if (/[|()]/.test(body)) return undefined;
	let out = "";
	let index = 0;
	while (index < body.length) {
		let unit: string | undefined;
		const character = body[index];
		if (character === "[") {
			const close = body.indexOf("]", index + 1);
			if (close === -1) return undefined;
			unit = firstOfClass(body.slice(index + 1, close));
			index = close + 1;
		} else if (character === "\\") {
			unit = ESCAPES[body[index + 1] ?? ""] ?? body[index + 1];
			index += 2;
		} else if (character === ".") {
			unit = "a";
			index += 1;
		} else {
			unit = character;
			index += 1;
		}
		if (unit === undefined) return undefined;
		// The quantifier that follows decides how many of the unit just read are emitted.
		const rest = body.slice(index);
		const braced = /^\{(\d+)(?:,(\d*))?\}/.exec(rest);
		if (braced !== undefined && braced !== null) {
			out += unit.repeat(Number(braced[1]));
			index += braced[0].length;
		} else if (rest.startsWith("+")) {
			out += unit;
			index += 1;
		} else if (rest.startsWith("*") || rest.startsWith("?")) {
			index += 1;
		} else {
			out += unit;
		}
	}
	return out;
}

const ESCAPES: Readonly<Record<string, string>> = {
	d: "1",
	w: "a",
	s: " ",
	S: "a",
	W: "-",
	D: "a",
};

/** The first member a character class admits, expanding a range to its lower bound. */
function firstOfClass(body: string): string | undefined {
	const negated = body.startsWith("^");
	if (negated) return "a";
	const range = /^\\?(.)-(.)/.exec(body);
	if (range !== null) return range[1];
	if (body.startsWith("\\")) return ESCAPES[body[1] ?? ""] ?? body[1];
	return body[0];
}

/**
 * A string the pattern accepts, or `undefined` where none was found.
 *
 * Every candidate is put to the expression itself, so a value only ever reaches a probe when the
 * document's own rule says it conforms.
 */
function satisfying(pattern: string): string | undefined {
	let expression: RegExp;
	try {
		expression = new RegExp(pattern, "u");
	} catch {
		try {
			expression = new RegExp(pattern);
		} catch {
			return undefined;
		}
	}
	const drawn = sample(pattern);
	const candidates = drawn === undefined ? PATTERN_CANDIDATES : [drawn, ...PATTERN_CANDIDATES];
	return candidates.find((candidate) => expression.test(candidate));
}

function typeOf(schema: Schema): string | undefined {
	const declared = schema["type"];
	if (typeof declared === "string") return declared;
	// 3.1 spells nullability as a type array; the first non-null entry is the shape a value takes.
	if (Array.isArray(declared))
		return declared.find((entry) => entry !== "null") as string | undefined;
	return undefined;
}

function deref(schema: Schema, resolve: Resolve, seen: ReadonlySet<string>): Schema | undefined {
	const ref = schema["$ref"];
	if (typeof ref !== "string") return schema;
	// A cycle has no finite instance, and following one hangs the suite rather than failing it.
	if (seen.has(ref)) return undefined;
	const target = resolve(ref);
	return target === undefined ? undefined : deref(target, resolve, new Set([...seen, ref]));
}

/**
 * **The smallest instance the document accepts, or `undefined` where none can be built.**
 *
 * A probe is a mutation OF a valid instance, so without one every arm would be vacuous - both sides
 * reject, they agree, and nothing was tested. Returning `undefined` rather than guessing is what
 * makes that visible: `behaviour.test.ts` counts the components it could not build and floors the
 * ones it could, so a change that quietly stops producing instances fails instead of passing.
 *
 * `pattern` is the honest limit. Satisfying an arbitrary regex means generating from it, so a string
 * carrying one is refused here and the component is skipped unless the pattern happens to accept the
 * plain instance.
 */
export function baseInstance(
	schema: Schema | undefined,
	resolve: Resolve,
	seen: ReadonlySet<string> = new Set(),
): unknown {
	if (schema === undefined) return undefined;
	const resolved = deref(schema, resolve, seen);
	if (resolved === undefined) return undefined;
	const nextSeen = typeof schema["$ref"] === "string" ? new Set([...seen, schema["$ref"]]) : seen;

	if (Array.isArray(resolved["enum"]) && resolved["enum"].length > 0) return resolved["enum"][0];
	if ("const" in resolved) return resolved["const"];

	for (const key of ["anyOf", "oneOf"] as const) {
		const branches = resolved[key];
		if (Array.isArray(branches)) {
			for (const branch of branches) {
				const built = baseInstance(branch as Schema, resolve, nextSeen);
				if (built !== undefined) return built;
			}
			return undefined;
		}
	}
	// `allOf` composes constraints that would have to be merged to be satisfied together. Declined.
	if (Array.isArray(resolved["allOf"])) return undefined;

	switch (typeOf(resolved)) {
		case "string": {
			const conformant = FORMAT_INSTANCES[String(resolved["format"] ?? "")];
			if (conformant !== undefined) return conformant;
			const pattern = resolved["pattern"];
			if (typeof pattern === "string") return satisfying(pattern);
			const min = typeof resolved["minLength"] === "number" ? resolved["minLength"] : 1;
			const max = typeof resolved["maxLength"] === "number" ? resolved["maxLength"] : min;
			return ascii(Math.max(min, Math.min(min, max)));
		}
		case "integer":
		case "number": {
			const min = resolved["minimum"] ?? resolved["exclusiveMinimum"];
			const max = resolved["maximum"] ?? resolved["exclusiveMaximum"];
			if (typeof resolved["exclusiveMinimum"] === "number") return resolved["exclusiveMinimum"] + 1;
			if (typeof min === "number") return min;
			if (typeof max === "number") return max;
			return 1;
		}
		case "boolean":
			return true;
		case "null":
			return null;
		case "array": {
			const min = typeof resolved["minItems"] === "number" ? resolved["minItems"] : 0;
			if (min === 0) return [];
			const element = baseInstance(resolved["items"] as Schema, resolve, nextSeen);
			return element === undefined ? undefined : Array.from({ length: min }, () => element);
		}
		case "object":
		default: {
			const properties = resolved["properties"];
			if (typeof properties !== "object" || properties === null) return undefined;
			const required = Array.isArray(resolved["required"])
				? (resolved["required"] as string[])
				: [];
			const instance: Record<string, unknown> = {};
			for (const key of required) {
				const built = baseInstance((properties as Record<string, Schema>)[key], resolve, nextSeen);
				if (built === undefined) return undefined;
				instance[key] = built;
			}
			return instance;
		}
	}
}

/** A shallow clone with one property replaced, so each probe differs from the base in ONE fact. */
function withProperty(base: unknown, key: string, value: unknown): unknown {
	return { ...(base as Record<string, unknown>), [key]: value };
}

function withoutProperty(base: unknown, key: string): unknown {
	const clone = { ...(base as Record<string, unknown>) };
	delete clone[key];
	return clone;
}

/**
 * The probes for one component, each a single-fact mutation of {@link baseInstance}.
 *
 * **Depth one, deliberately.** Every constraint this emitter writes is applied to the property it
 * was declared on (`applyConstraints`), so a boundary at depth one exercises the same code path a
 * boundary at depth five would, and the probe count stays proportional to the corpus rather than to
 * its nesting. A nested component is reached as its own component, because the document declares it
 * as one.
 *
 * A probe is emitted only where the keyword is actually present, so the count is a fact about the
 * corpus rather than about this file, and `behaviour.test.ts` floors it per keyword.
 */
export function probesFor(schema: Schema | undefined, resolve: Resolve): readonly Probe[] {
	if (schema === undefined) return [];
	const resolved = deref(schema, resolve, new Set());
	if (resolved === undefined || typeOf(resolved) === "array") return [];
	const base = baseInstance(resolved, resolve);
	if (typeof base !== "object" || base === null || Array.isArray(base)) return [];

	const properties = resolved["properties"];
	if (typeof properties !== "object" || properties === null) return [];
	const shape = properties as Record<string, Schema>;
	const required = Array.isArray(resolved["required"]) ? (resolved["required"] as string[]) : [];
	const probes: Probe[] = [
		{ keyword: "(base)", why: "the minimal conformant instance", value: base },
	];

	for (const [key, declaredRaw] of Object.entries(shape)) {
		const declared = deref(declaredRaw, resolve, new Set());
		if (declared === undefined) continue;
		const present = (base as Record<string, unknown>)[key] !== undefined;
		const kind = typeOf(declared);

		const formatted = FORMAT_INSTANCES[String(declared["format"] ?? "")] !== undefined;
		if (kind === "string" && typeof declared["pattern"] !== "string" && !formatted) {
			const max = declared["maxLength"];
			if (typeof max === "number" && max > 0) {
				// The whole point: `maxLength` counts code points, and one emoji is two UTF-16 units.
				probes.push({
					keyword: "maxLength",
					why: `'${key}' at maxLength in astral code points`,
					value: withProperty(base, key, astral(max)),
				});
				probes.push({
					keyword: "maxLength",
					why: `'${key}' one over maxLength in astral code points`,
					value: withProperty(base, key, astral(max + 1)),
				});
				probes.push({
					keyword: "maxLength",
					why: `'${key}' at maxLength in ascii`,
					value: withProperty(base, key, ascii(max)),
				});
				probes.push({
					keyword: "maxLength",
					why: `'${key}' one over maxLength in ascii`,
					value: withProperty(base, key, ascii(max + 1)),
				});
			}
			const min = declared["minLength"];
			if (typeof min === "number" && min > 0) {
				probes.push({
					keyword: "minLength",
					why: `'${key}' at minLength in astral code points`,
					value: withProperty(base, key, astral(min)),
				});
				probes.push({
					keyword: "minLength",
					why: `'${key}' one under minLength in astral code points`,
					value: withProperty(base, key, astral(min - 1)),
				});
				probes.push({
					keyword: "minLength",
					why: `'${key}' at minLength in ascii`,
					value: withProperty(base, key, ascii(min)),
				});
				probes.push({
					keyword: "minLength",
					why: `'${key}' one under minLength in ascii`,
					value: withProperty(base, key, ascii(min - 1)),
				});
			}
		}

		if (kind === "number" || kind === "integer") {
			for (const [keyword, at, beyond] of [
				["maximum", declared["maximum"], 1],
				["minimum", declared["minimum"], -1],
			] as const) {
				if (typeof at === "number") {
					probes.push({
						keyword,
						why: `'${key}' at ${keyword}`,
						value: withProperty(base, key, at),
					});
					probes.push({
						keyword,
						why: `'${key}' beyond ${keyword}`,
						value: withProperty(base, key, at + beyond),
					});
				}
			}
			for (const [keyword, bound, inside] of [
				["exclusiveMaximum", declared["exclusiveMaximum"], -1],
				["exclusiveMinimum", declared["exclusiveMinimum"], 1],
			] as const) {
				if (typeof bound === "number") {
					probes.push({
						keyword,
						why: `'${key}' on ${keyword}`,
						value: withProperty(base, key, bound),
					});
					probes.push({
						keyword,
						why: `'${key}' inside ${keyword}`,
						value: withProperty(base, key, bound + inside),
					});
				}
			}
		}

		if (kind === "array") {
			const element = baseInstance(declared["items"] as Schema, resolve);
			const list = (length: number): unknown =>
				withProperty(
					base,
					key,
					Array.from({ length }, () => element),
				);
			/**
			 * **Both sides of an array bound, because probing one side is blind in one direction.**
			 *
			 * Only the failing length was sent at first, which catches a validator that is too LOOSE
			 * and says nothing about one that is too tight: `@maxItems(6)` emitted as `.max(5)` refuses
			 * a conformant six-element array, and no probe ever sent six. The at-bound value is the one
			 * that catches it - the same asymmetry `constraints.tsp` records for open elements a level
			 * down, where a one-directional read let an over-constrained validator stay invisible.
			 */
			const max = declared["maxItems"];
			if (typeof max === "number" && element !== undefined) {
				probes.push({ keyword: "maxItems", why: `'${key}' at maxItems`, value: list(max) });
				probes.push({
					keyword: "maxItems",
					why: `'${key}' one over maxItems`,
					value: list(max + 1),
				});
			}
			const min = declared["minItems"];
			if (typeof min === "number" && min > 0 && element !== undefined) {
				probes.push({ keyword: "minItems", why: `'${key}' at minItems`, value: list(min) });
				probes.push({
					keyword: "minItems",
					why: `'${key}' one under minItems`,
					value: list(min - 1),
				});
			}
		}

		if (present && kind !== undefined && !formatted) {
			// A value of the wrong JSON type, which every `type` keyword must refuse identically.
			const wrong = kind === "string" ? 1 : "not-of-the-declared-type";
			probes.push({
				keyword: "type",
				why: `'${key}' carrying the wrong JSON type`,
				value: withProperty(base, key, wrong),
			});
		}
	}

	for (const key of required) {
		probes.push({
			keyword: "required",
			why: `'${key}' omitted`,
			value: withoutProperty(base, key),
		});
	}

	probes.push({
		keyword: "additionalProperties",
		why: "an undeclared property beside the declared ones",
		value: withProperty(base, "probeSurplusKey", "surplus"),
	});

	return probes;
}
