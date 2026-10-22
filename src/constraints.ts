import {
	getMaxItems,
	getMaxLength,
	getMaxValue,
	getMinItems,
	getMinLength,
	getMinValue,
	getMinValueExclusive,
	getMaxValueExclusive,
	getPattern,
	getMaxValueForScalar,
	getMinValueForScalar,
	type Program,
	type Scalar,
	serializeValueAsJson,
	type Type,
} from "@typespec/compiler";
import { defaultMaxSteps, isSafePattern } from "redos-detector";
import { reportDiagnostic } from "./lib.js";
import { escapeNonAscii } from "./literal.js";
import { encodedValueOf, isArrayLiteral, jsonTypeOfScalar, scalarEncodingOf } from "./zod.js";

/**
 * Constraint decorators -> the Zod modifiers that enforce them.
 *
 * These are **first-party** TypeSpec decorators (`@minLength`, `@pattern`, ...), which matters twice
 * over: the spec author writes standard TypeSpec rather than a dialect, and `@typespec/openapi3`
 * documents them without any help from this emitter.
 *
 * **This package ships no decorators of its own.** A refinement decorator would be an arbitrary
 * predicate, which a type language has no way to say and therefore no document can publish, so a
 * validator enforcing it would enforce something no caller could read. A trimming decorator is the
 * other kind: `.trim()` is a transform, and transforming a value before validating it makes the
 * runtime accept inputs the published contract rejects. The spec states `@pattern` instead, which
 * openapi3 publishes. `src/tsp-index.ts` exports `$lib` and no `$decorators`, and
 * `vocabulary.test.ts` asserts that no emitted file carries a `.refine(` outside the one
 * multipart-file carve-out.
 */
export function applyConstraints(
	program: Program,
	expression: string,
	target: Type,
	options: {
		/**
		 * The JSON type of the value the expression is, where the caller knows it better - a member of
		 * a union, which the target's own type does not say.
		 */
		readonly type?: string;
		/** Drop an inapplicable keyword without reporting it: JSON Schema skips it for this member. */
		readonly quiet?: boolean;
	} = {},
): string {
	// A refused value carries no method to constrain, and needs none: it accepts nothing already.
	if (expression.startsWith("z.never()")) return expression;
	let result = expression;
	const read = <T>(get: (program: Program, target: Type) => T | undefined): T | undefined =>
		declaredOn(program, target, get);

	const minLength = read(getMinLength);
	const maxLength = read(getMaxLength);
	const minValue = read(minimumOf);
	const maxValue = read(maximumOf);
	const minItems = read(getMinItems);
	const maxItems = read(getMaxItems);
	const pattern = read(getPattern);

	const minExclusive = read(getMinValueExclusive);
	const maxExclusive = read(getMaxValueExclusive);

	/**
	 * **A keyword applies to one JSON type, and `@encode` can change the type under it.**
	 *
	 * openapi3 applies a property's or a scalar's constraints and THEN lets the encoding replace
	 * `type`, so `@encode(string)` on a numeric property publishes `minimum` beside `type: string`,
	 * and `@encode("x", int32)` on a string publishes `pattern` beside `type: integer`. JSON Schema
	 * applies `minimum` to numbers, `minLength` and `pattern` to strings and `minItems` to arrays, and
	 * ignores each everywhere else - so the document asserts none of them there.
	 *
	 * Applied anyway, `@minValue(1)` on a string emitted a LENGTH check that accepted `"0"`, and
	 * `.gt()`, `.regex()` on an integer or `.min()` on a boolean is not a function at all: the module
	 * threw on import and took the whole service down. So each keyword the encoded value cannot carry
	 * is dropped, as the document drops it, and reported, because the author wrote a rule nothing
	 * enforces.
	 */
	const type = options.type ?? valueJsonTypeOf(program, target);
	const dropped: string[] = [];
	const applies = (keyword: string, value: unknown, family: readonly string[]): boolean => {
		if (value === undefined) return false;
		if (type === undefined || family.includes(type)) return true;
		dropped.push(keyword);
		return false;
	};
	const TEXT = ["string"];
	const NUMBER = ["integer", "number"];
	const LIST = ["array"];
	const keep = {
		minLength: applies("@minLength", minLength, TEXT),
		maxLength: applies("@maxLength", maxLength, TEXT),
		pattern: applies("@pattern", pattern, TEXT),
		minValue: applies("@minValue", minValue, NUMBER),
		maxValue: applies("@maxValue", maxValue, NUMBER),
		minExclusive: applies("@minValueExclusive", minExclusive, NUMBER),
		maxExclusive: applies("@maxValueExclusive", maxExclusive, NUMBER),
		minItems: applies("@minItems", minItems, LIST),
		maxItems: applies("@maxItems", maxItems, LIST),
	};
	if (dropped.length > 0 && type !== undefined && options.quiet !== true) {
		reportUnenforceableEncoded(program, target, dropped, type);
	}

	// `@minLength`/`@minValue`/`@minItems` all land on Zod's `.min()`; they are distinguished by the
	// JSON type they apply to, and at most one of them applies to any one value.
	const min = keep.minLength
		? minLength
		: keep.minValue
			? minValue
			: keep.minItems
				? minItems
				: undefined;
	const max = keep.maxLength
		? maxLength
		: keep.maxValue
			? maxValue
			: keep.maxItems
				? maxItems
				: undefined;
	if (min !== undefined) result += `.min(${min})`;
	if (max !== undefined) result += `.max(${max})`;
	// Exclusive bounds are a distinct question from inclusive ones - `z.number().positive()` is
	// `.gt(0)`, and emitting `.min(0)` for it would accept the `0` it refuses.
	if (keep.minExclusive) result += `.gt(${minExclusive})`;
	if (keep.maxExclusive) result += `.lt(${maxExclusive})`;
	if (keep.pattern && pattern !== undefined) {
		reportNonUnicodePattern(program, pattern, target);
		result += `.regex(${patternToRegex(pattern)})`;
	}

	return result;
}

/** Whether a property or scalar declares any constraint this module enforces. */
export function hasConstraints(program: Program, target: Type): boolean {
	if (isListLiteral(program, target)) return false;
	return [
		getMinLength,
		getMaxLength,
		getMinValue,
		getMaxValue,
		getMinValueExclusive,
		getMaxValueExclusive,
		getMinItems,
		getMaxItems,
		getPattern,
		getMinValueForScalar,
		getMaxValueForScalar,
	].some((get) => get(program, target) !== undefined);
}

/**
 * The constraint of a property or scalar that a string value breaks - `@maxLength(3)` - or
 * `undefined` where it keeps every one. Read as JSON Schema reads them: lengths in code points, and a
 * pattern that matches anywhere in the value unless it anchors itself.
 */
export function brokenConstraintOf(
	program: Program,
	target: Type,
	value: string | number | boolean,
): string | undefined {
	const read = <T>(get: (program: Program, target: Type) => T | undefined): T | undefined =>
		declaredOn(program, target, get);
	if (typeof value === "boolean") return undefined;
	if (typeof value === "number") {
		const minimum = read(minimumOf);
		if (minimum !== undefined && value < minimum) return `'@minValue(${minimum})'`;
		const maximum = read(maximumOf);
		if (maximum !== undefined && value > maximum) return `'@maxValue(${maximum})'`;
		const above = read(getMinValueExclusive);
		if (above !== undefined && value <= above) return `'@minValueExclusive(${above})'`;
		const below = read(getMaxValueExclusive);
		if (below !== undefined && value >= below) return `'@maxValueExclusive(${below})'`;
		return undefined;
	}
	const length = [...value].length;
	const minLength = read(getMinLength);
	if (minLength !== undefined && length < minLength) return `'@minLength(${minLength})'`;
	const maxLength = read(getMaxLength);
	if (maxLength !== undefined && length > maxLength) return `'@maxLength(${maxLength})'`;
	const pattern = read(getPattern);
	if (pattern !== undefined) {
		let expression: RegExp;
		try {
			expression = new RegExp(pattern, "u");
		} catch {
			expression = new RegExp(pattern);
		}
		if (!expression.test(value)) return `'@pattern'`;
	}
	return undefined;
}

/** The `@minItems` or `@maxItems` of a property or a named list model that a list's length breaks. */
export function brokenItemsOf(program: Program, target: Type, count: number): string | undefined {
	const minItems = declaredOn(program, target, getMinItems);
	if (minItems !== undefined && count < minItems) return `'@minItems(${minItems})'`;
	const maxItems = declaredOn(program, target, getMaxItems);
	if (maxItems !== undefined && count > maxItems) return `'@maxItems(${maxItems})'`;
	return undefined;
}

/**
 * **`@minValue` as the number the document publishes**: a numeric bound as written, and a bound on a
 * date or duration as the value its `@encode` puts on the wire - `@minValue(utcDateTime.fromISO(...))`
 * under `unixTimestamp` is published as `minimum: 1577836800`. This is openapi3's own
 * `getMinValueAsJson`, which publishes nothing where the value is not a number, and so neither does
 * this. Read through `getMinValue` alone, the date bound was dropped while the document enforced it.
 */
function minimumOf(program: Program, target: Type): number | undefined {
	const numeric = getMinValue(program, target);
	if (numeric !== undefined) return numeric;
	const value = getMinValueForScalar(program, target);
	if (value === undefined) return undefined;
	const json = serializeValueAsJson(program, value, target);
	return typeof json === "number" ? json : undefined;
}

/** `@maxValue` as the number the document publishes - see {@link minimumOf}. */
function maximumOf(program: Program, target: Type): number | undefined {
	const numeric = getMaxValue(program, target);
	if (numeric !== undefined) return numeric;
	const value = getMaxValueForScalar(program, target);
	if (value === undefined) return undefined;
	const json = serializeValueAsJson(program, value, target);
	return typeof json === "number" ? json : undefined;
}

/**
 * The JSON type of the value a property or scalar's constraints are applied to, once `@encode` has
 * had its say - or `undefined` where nothing encodes it, and TypeSpec has already checked that each
 * keyword is legal on the type.
 */
function valueJsonTypeOf(program: Program, target: Type): string | undefined {
	if (target.kind === "Scalar") {
		return scalarEncodingOf(program, target) === undefined
			? undefined
			: jsonTypeOfScalar(program, target);
	}
	if (target.kind !== "ModelProperty") return undefined;
	const encoding = encodedValueOf(program, target);
	if (encoding.kind === "replaced" || encoding.kind === "both") {
		return jsonTypeOfScalar(program, encoding.scalar);
	}
	if (encoding.kind === "unsatisfiable") return undefined;
	const declared = nullableInnerOfType(target.type) ?? target.type;
	return declared.kind === "Scalar" && scalarEncodingOf(program, declared) !== undefined
		? jsonTypeOfScalar(program, declared)
		: undefined;
}

/** The non-null half of a two-variant `T | null` union. */
function nullableInnerOfType(type: Type): Type | undefined {
	if (type.kind !== "Union") return undefined;
	const variants = [...type.variants.values()].map((variant) => variant.type);
	const real = variants.filter((v) => !(v.kind === "Intrinsic" && v.name === "null"));
	return real.length === variants.length - 1 && real.length === 1 ? real[0] : undefined;
}

/** `unenforceable-encoded-constraint`, once per declaration however many positions apply it. */
export function reportUnenforceableEncoded(
	program: Program,
	target: Type,
	keywords: readonly string[],
	type: string,
): void {
	const detail = `${keywords.join(",")} ${type}`;
	if (!firstReportOf(program, "unenforceable-encoded-constraint", target, detail)) return;
	reportDiagnostic(program, {
		code: "unenforceable-encoded-constraint",
		target,
		format: {
			name: target.kind === "ModelProperty" || target.kind === "Scalar" ? target.name : "",
			keywords: keywords.map((keyword) => `'${keyword}'`).join(", "),
			type,
		},
	});
}

/**
 * **A constraint on a scalar is read up its `extends` chain: the nearest scalar declaring it wins.**
 *
 * The compiler's getters read the decorators of the one type they are handed, and this read the
 * scalar a property NAMED. So `scalar ShortWord extends Word` with `@pattern` on `Word` validated
 * as a bare `z.string()`, and every value the pattern forbids was accepted - while the document
 * published the pattern on `ShortWord`. `@typespec/openapi3`'s `#getSchemaForScalar` builds a
 * derived scalar from its base's schema and then applies its own decorators over it, so a keyword
 * the derived scalar declares REPLACES the base's rather than adding to it. Reading the nearest
 * declaration per keyword is that rule exactly: `Overrides extends Word` with its own `@pattern`
 * publishes only its own, and enforcing both would refuse what the document accepts.
 *
 * A property is not a chain: its type's constraints are applied where the type is rendered.
 */
function declaredOn<T>(
	program: Program,
	target: Type,
	get: (program: Program, target: Type) => T | undefined,
): T | undefined {
	if (isListLiteral(program, target)) return undefined;
	if (target.kind !== "Scalar") return get(program, target);
	for (
		let current: Scalar | undefined = target;
		current !== undefined;
		current = current.baseScalar
	) {
		const value = get(program, current);
		if (value !== undefined) return value;
	}
	return undefined;
}

/**
 * **A list openapi3 takes for a literal publishes none of its own keywords**, so none is enforced. A
 * list model the spec names `Array` is one - see `isArrayLiteral` - and openapi3 writes it out where
 * it is used as `{ type: "array", items }` and nothing else, its `@minItems`, `@maxItems`, `@doc` and
 * `@summary` dropped. Measured on `@minItems(1) model Array is int32[]` as `a?: Array`: the document
 * accepts `{ a: [] }`, and the validator, `z.array(z.int32()).min(1)`, refused it - in a body, a
 * response, a query and a header alike. A keyword on the property holding it is the property's own,
 * and is published.
 */
function isListLiteral(program: Program, target: Type): boolean {
	return target.kind === "Model" && isArrayLiteral(program, target);
}

/**
 * How much analysis one pattern gets before the answer is "could not prove it": a number of steps.
 *
 * **Bounded, because the analysis is itself exponential in the bad case, and bounded in STEPS,
 * because a verdict must not depend on the machine.** It was 500 ms of wall-clock time, and under
 * load an ordinary pattern can decide inside that on one build and run out on the next, so the same
 * spec warned on one build and not the next. A step count is the same everywhere.
 * `redos-detector`'s own default; measured, `^(a|a)+$` spends it in 1.7 seconds idle and 6 under
 * load, and every ordinary pattern decides in milliseconds. A pattern that cannot be decided inside
 * it is one this emitter cannot certify, which is what the warning says.
 */
const ANALYSIS_STEPS = defaultMaxSteps;

/**
 * Patterns already judged, keyed on the text, which is the only input the verdict depends on.
 *
 * The analysis costs up to {@link ANALYSIS_STEPS} steps a pattern, and one pattern text commonly
 * recurs across declarations - a date pattern such as `^\\d{4}-\\d{2}-\\d{2}$` on several scalars -
 * so each distinct text is analysed once per process.
 */
const verdicts = new Map<string, boolean>();

/**
 * Which declarations have already been reported, per program.
 *
 * **Per PROGRAM, and that distinction is the whole reason this is a `WeakMap`.** One scalar carrying
 * a pattern is reached once per USE - the reference service reaches a single scalar 153 times - and
 * three identical warnings pointing at one declaration are noise a reader learns to skip. But a
 * module-level "already said that" would also silence the second compile in a watch session, or the
 * second service in one program, which is a warning lost rather than a warning tidied. Keyed on the
 * program, it is emptied whenever the program is.
 *
 * The verdict cache above is different and is deliberately global: it is a pure function of the
 * pattern text, so it cannot be wrong for a later program.
 */
const reported = new WeakMap<Program, Map<string, WeakMap<object, Set<string>>>>();

/**
 * **Whether this diagnostic has already been raised against this declaration.**
 *
 * Keyed on the code as well as the target. Keying on the target alone once made the memo shared
 * between every pattern diagnostic, so whichever ran first claimed the declaration and silenced
 * the rest: measured on `^(\w+\s?)*\-$`, one warning where two were due. The ReDoS judgement has
 * since moved to a linter rule, which reports per declaration by construction, so that pairing can
 * no longer meet here - but a memo keyed on the target alone is the wrong shape for the next
 * diagnostic added beside this one, and costs nothing to keep right.
 *
 * The de-duplication itself is per declaration, because emission reaches a scalar once per USE -
 * 153 times for a single scalar in the reference service - and repeating one warning that often
 * is noise a reader learns to skip, which is how a real one gets missed.
 *
 * **A declaration is its SOURCE, not the type object the walk holds.** The compiler hands out
 * distinct objects for one declaration: `model B is A` copies `A`'s properties, a spread copies the
 * spread model's, and each versioning projection clones the whole service - once per emitter that
 * asks for it. Keyed on the object, one `@encode` was reported twice through `model B is A`, and
 * every diagnostic twice when `typespec-hono` and this emitter projected one versioned service in one
 * compile. The syntax node is shared by every copy, so it is the key where there is one. `detail`
 * keeps two different findings at one node apart - a template property instantiated with two
 * different types is one node and two declarations.
 */
export function firstReportOf(program: Program, code: string, target: Type, detail = ""): boolean {
	let byCode = reported.get(program);
	if (byCode === undefined) {
		byCode = new Map();
		reported.set(program, byCode);
	}
	let already = byCode.get(code);
	if (already === undefined) {
		already = new WeakMap();
		byCode.set(code, already);
	}
	const source = (target as { node?: object }).node ?? target;
	let details = already.get(source);
	if (details === undefined) {
		details = new Set();
		already.set(source, details);
	}
	if (details.has(detail)) return false;
	details.add(detail);
	return true;
}

/**
 * **Whether a `@pattern` can be proven safe against catastrophic backtracking.**
 *
 * A pure verdict, with no program and no report. The judgement belongs to the
 * `redos-prone-pattern` LINTER rule rather than to emission, because the spec is valid, the
 * document is correct and the emitted regex is exactly the published one: what is wrong is a cost
 * no artefact states, which is the case TypeSpec reserves for a linter.
 *
 * **The engine is the one Zod runs on**, so the analysis carries whichever flag
 * {@link patternToRegex} will emit. Analysing `\p{L}+` with `unicode: false` asks about a different
 * expression from the one that runs - the identity escape for `p` - and a verdict about the wrong
 * pattern is worth nothing whichever way it comes out.
 *
 * **`false` means "not proven safe", not "proven dangerous"**, and the rule's wording follows that.
 * `redos-detector` proves safety rather than guessing at danger, so a pattern it cannot decide inside
 * the step budget is judged the same way as one it decides against. Measured over a realistic spread of
 * 14 patterns an API would carry: 2 conservative warnings, both on a quantifier nested over an
 * overlapping class, and nothing dangerous missed - including `^\w+([.-]?\w+)*$`, which reads as
 * ordinary and takes **11 seconds** on a 29-character input.
 */
export function patternIsProvablySafe(pattern: string): boolean {
	let safe = verdicts.get(pattern);
	if (safe === undefined) {
		try {
			safe = isSafePattern(pattern, {
				unicode: unicodeSafe(pattern),
				maxSteps: ANALYSIS_STEPS,
				timeout: Number.POSITIVE_INFINITY,
			}).safe;
		} catch {
			// A pattern the analyser cannot even parse is not one to make a claim about.
			safe = true;
		}
		verdicts.set(pattern, safe);
	}
	return safe;
}

/**
 * A `@pattern` string becomes a regex literal - **verbatim**.
 *
 * **This used to add anchors, and that was wrong twice over.**
 *
 * The docblock claimed "TypeSpec's `@pattern` is a full-match assertion (it follows JSON Schema)".
 * JSON Schema says the opposite, in as many words: *"Recall: regular expressions are not implicitly
 * anchored"* (2020-12 validation, `pattern`). So the document published one expression and the
 * validator enforced another, and the caller who read the document was the one who got the 400.
 *
 * Worse, the anchoring was not even an anchoring. `^` and `$` bind looser than `|`, so a top-level
 * alternation changed meaning rather than being constrained: a pattern `\S|^$` became `^\S|^$`,
 * which is `(^\S)|(^$)` - "starts with a non-space, or is empty". On `"  Alex  "` the document said
 * valid and the validator rejected; on `"Alex  "` the validator accepted what the pattern's own
 * stated intent forbids.
 *
 * A pattern that means to match the whole string says so in the spec - `^\S(?:[\s\S]*\S)?$`, which
 * is the standard construct for it. That way the document and the validator carry
 * the identical expression, and the conformance differential can assert it character for character
 * instead of guessing at an equivalence.
 */
export function patternToRegex(pattern: string): string {
	return `/${escapeNonAscii(escapeSlashes(pattern))}/${unicodeSafe(pattern) ? "u" : ""}`;
}

/**
 * **Escapes the slashes a regex literal needs escaped, and only those.**
 *
 * A `.replace(/\//g, "\\/")` escapes unconditionally, so a pattern that already spelled a slash
 * as an escape had its backslash doubled: `^\/api\/v[0-9]+$` became the literal
 * `/^\\/api\\/v[0-9]+$/u`, which ends at the third slash and reads `api` as flags. Measured on
 * that pattern: `tsp compile` EXIT=0 and silent, `node` refused the emitted module with
 * `SyntaxError: Invalid regular expression flags`, and `tsc` reported `TS1127: Invalid character`.
 * A path regex is the most ordinary place a slash appears, and no fixture here had ever carried
 * one - nor does any of the 67 specs in `@typespec/http-specs`.
 *
 * A backslash takes the character after it with it, so `\/` is already escaped and is left alone,
 * while `\\` is a literal backslash and a slash following it still needs escaping. `\/` remains a
 * legal identity escape under the `u` flag, so this does not change which patterns can carry it.
 */
function escapeSlashes(pattern: string): string {
	let escaped = "";
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index];
		if (character === "\\") {
			const next = pattern[index + 1] ?? "";
			/**
			 * **An identity escape of a character outside printable ASCII loses its backslash**, because
			 * the character is about to be written as `\uXXXX` and `\\uXXXX` would be a literal
			 * backslash followed by `u`. An accented letter matches the same thing escaped or not; under
			 * the `u` flag the escape is a syntax error, and `unicodeSafe` has already sent such a
			 * pattern to the bare form.
			 */
			escaped += /[^\x20-\x7e]/.test(next) ? next : character + next;
			index += 1;
			continue;
		}
		escaped += character === "/" ? "\\/" : character;
	}
	return escaped;
}

/**
 * Whether the expression is one the `u` flag accepts, which is how a JSON Schema reader compiles it.
 *
 * **The flag is part of the contract, and leaving it off was the divergence.** A bare `/.../` makes
 * `\p{L}` an identity escape for the letter `p`, so the expression the server ran was not the
 * expression the spec author wrote. Measured against Ajv on the published document, with every
 * verdict inverted:
 *
 * ```
 * value        document (Ajv)   emitted validator
 * "abc"        VALID            INVALID
 * "Unicode"    VALID            INVALID
 * "p{L}"       INVALID          VALID
 * ```
 *
 * Ajv compiles a JSON Schema `pattern` with `u` by default, so carrying it here is not a rule laid
 * on top of the contract; it is the contract.
 *
 * **Only when the pattern compiles under it.** `u` makes several ordinary spellings an error - a
 * redundant `\-` outside a character class, a lone `]` or `{`, an identity escape such as `\a` - and
 * 5 of 15 realistic patterns tested fail to compile with it. Those keep the bare form they already
 * had, and {@link reportNonUnicodePattern} says so at build time, because a reader of the document
 * cannot compile them either.
 */
export function unicodeSafe(pattern: string): boolean {
	try {
		new RegExp(pattern, "u");
		return true;
	} catch {
		return false;
	}
}

/**
 * Warn when a `@pattern` is one a JSON Schema reader cannot compile at all.
 *
 * Separate from the `redos-prone-pattern` linter rule because the failure runs the other way: that
 * one is about a pattern the validator runs too slowly, this one about a pattern nothing READING
 * the document can run. And this one stays a diagnostic, because here the emitter cannot do what the
 * spec asks: it falls back to a different expression from the one it publishes. Measured, Ajv on a published `^\-?\d+$`:
 * `Invalid regular expression: /^\-?\d+$/u: Invalid escape`. The emitted validator falls back to the
 * bare form and enforces it anyway, so the two artefacts stop agreeing without either one failing.
 *
 * De-duplicated per declaration through {@link firstReportOf}, which keys on the diagnostic as
 * well as the declaration. Sharing one memo between the two warnings meant a declaration with
 * both faults reported only whichever ran first.
 */
function reportNonUnicodePattern(program: Program, pattern: string, target: Type): void {
	if (unicodeSafe(pattern)) return;
	if (!firstReportOf(program, "non-unicode-pattern", target)) return;
	reportDiagnostic(program, { code: "non-unicode-pattern", format: { pattern }, target });
}
