import {
	getEncode,
	getMaxItems,
	getMaxLength,
	getMaxValue,
	getMinItems,
	getMinLength,
	getMinValue,
	getMinValueExclusive,
	getMaxValueExclusive,
	getPattern,
	type Program,
	type Type,
} from "@typespec/compiler";
import { isSafePattern } from "redos-detector";
import { reportDiagnostic } from "./lib.js";

/**
 * Constraint decorators -> the Zod modifiers that enforce them.
 *
 * These are **first-party** TypeSpec decorators (`@minLength`, `@pattern`, ...), which matters twice
 * over: the spec author writes standard TypeSpec rather than a dialect, and `@typespec/openapi3`
 * documents them without any help from us.
 *
 * **This package ships no decorators of its own, and the two it used to have are gone.** `@refine`
 * was an arbitrary predicate, which a type language has no way to say and therefore no document can
 * publish, so a validator enforcing it enforced something no caller could read. `@trimmed` was the
 * other: `.trim()` is a transform, and transforming a value before validating it makes the runtime
 * accept inputs the published contract rejects. The spec states `@pattern` instead, which openapi3
 * publishes. `src/tsp-index.ts` exports `$lib` and no `$decorators`, and `vocabulary.test.ts`
 * asserts that no emitted file carries a `.refine(` outside the one multipart-file carve-out.
 */
export function applyConstraints(program: Program, expression: string, target: Type): string {
	let result = expression;

	const minLength = getMinLength(program, target);
	const maxLength = getMaxLength(program, target);
	const minValue = getMinValue(program, target);
	const maxValue = getMaxValue(program, target);
	const minItems = getMinItems(program, target);
	const maxItems = getMaxItems(program, target);
	const pattern = getPattern(program, target);

	const minExclusive = getMinValueExclusive(program, target);
	const maxExclusive = getMaxValueExclusive(program, target);

	/**
	 * **A numeric bound says nothing about a value carried as text.** `@encode(string)` is legal on a
	 * numeric property and makes the wire value a string, so the expression here is `z.string()` while
	 * `@minValue` is still a statement about the number it spells. Folding the two together emitted a
	 * LENGTH check: `@minValue(1)` accepted `"0"`, and `@minValue(100)` refused `"150"`. The exclusive
	 * form was worse - `z.string().gt(0)` is not a function, so the module threw on import and took
	 * the whole service down with it.
	 *
	 * It cannot be enforced either, and not for want of a mechanism: the document publishes `minimum`
	 * on a `type: string` schema, which JSON Schema ignores, so a validator that checked it would
	 * refuse payloads the published contract accepts. That is the same defect in the other direction,
	 * and this package's rule is that the two artefacts agree. So the bound is dropped and reported.
	 */
	const encodedAsText = encodesAsString(program, target);
	const numeric = [minValue, maxValue, minExclusive, maxExclusive].some(
		(bound) => bound !== undefined,
	);
	if (encodedAsText && numeric) {
		reportDiagnostic(program, {
			code: "unenforceable-encoded-bound",
			format: {
				name: target.kind === "ModelProperty" || target.kind === "Scalar" ? target.name : "",
			},
			target,
		});
	}

	// `@minLength`/`@minValue`/`@minItems` all land on Zod's `.min()`; they are distinguished by the
	// type they are legal on, which TypeSpec has already checked by the time we get here - except
	// under `@encode(string)`, where the type they are legal on is not the type emitted.
	const min = minLength ?? (encodedAsText ? undefined : minValue) ?? minItems;
	const max = maxLength ?? (encodedAsText ? undefined : maxValue) ?? maxItems;
	if (min !== undefined) result += `.min(${min})`;
	if (max !== undefined) result += `.max(${max})`;
	// Exclusive bounds are a distinct question from inclusive ones - `z.number().positive()` is
	// `.gt(0)`, and emitting `.min(0)` for it would accept a zero share count or a zero spot rate.
	if (!encodedAsText && minExclusive !== undefined) result += `.gt(${minExclusive})`;
	if (!encodedAsText && maxExclusive !== undefined) result += `.lt(${maxExclusive})`;
	if (pattern !== undefined) {
		reportNonUnicodePattern(program, pattern, target);
		result += `.regex(${patternToRegex(pattern)})`;
	}

	return result;
}

/**
 * Whether the value this type puts on the wire is text because `@encode` says so. Read from the
 * property and then from its scalar, which is where an encoding declared once for a named scalar
 * lives.
 */
function encodesAsString(program: Program, target: Type): boolean {
	if (target.kind !== "ModelProperty" && target.kind !== "Scalar") return false;
	const own = getEncode(program, target);
	const scalar =
		own === undefined && target.kind === "ModelProperty" && target.type.kind === "Scalar"
			? getEncode(program, target.type)
			: undefined;
	return (own ?? scalar)?.type.name === "string";
}

/**
 * How long one pattern may be analysed before the answer is "could not prove it".
 *
 * **Bounded, because the analysis is itself exponential in the bad case.** Measured: `^(a|a)+$`
 * takes 1.6 seconds to decide, and a build should not stall on a pattern whose whole problem is that
 * it does too much work. A pattern that cannot be decided inside this is one this emitter cannot
 * certify, which is what the warning says.
 */
const ANALYSIS_TIMEOUT_MS = 500;

/**
 * Patterns already judged, keyed on the text, which is the only input the verdict depends on.
 *
 * The analysis costs up to {@link ANALYSIS_TIMEOUT_MS} a pattern, and one pattern text commonly
 * recurs across declarations - `^\\d{4}-\\d{2}-\\d{2}$` appears on several scalars in more than one
 * consumer spec - so each distinct text is analysed once per process.
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
const reported = new WeakMap<Program, Map<string, WeakSet<Type>>>();

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
 */
function firstReportOf(program: Program, code: string, target: Type): boolean {
	let byCode = reported.get(program);
	if (byCode === undefined) {
		byCode = new Map();
		reported.set(program, byCode);
	}
	let already = byCode.get(code);
	if (already === undefined) {
		already = new WeakSet();
		byCode.set(code, already);
	}
	if (already.has(target)) return false;
	already.add(target);
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
 * the timeout is judged the same way as one it decides against. Measured over a realistic spread of
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
				timeout: ANALYSIS_TIMEOUT_MS,
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
 * alternation changed meaning rather than being constrained: the spec's `\S|^$` became `^\S|^$`,
 * which is `(^\S)|(^$)` - "starts with a non-space, or is empty". Measured on `"  Alex  "` the
 * document said valid and we rejected; on `"Alex  "` we accepted what the pattern's own stated
 * intent forbids. 153 of the 227 emitted `.regex()` calls came from that one scalar.
 *
 * A pattern that means to match the whole string says so in the spec - `^\S(?:[\s\S]*\S)?$`, which
 * is the standard construct for it. That way the document and the validator carry
 * the identical expression, and the conformance differential can assert it character for character
 * instead of guessing at an equivalence.
 */
export function patternToRegex(pattern: string): string {
	return `/${escapeSlashes(pattern)}/${unicodeSafe(pattern) ? "u" : ""}`;
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
			escaped += character + (pattern[index + 1] ?? "");
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
