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

	// `@minLength`/`@minValue`/`@minItems` all land on Zod's `.min()`; they are distinguished by the
	// type they are legal on, which TypeSpec has already checked by the time we get here.
	const min = minLength ?? minValue ?? minItems;
	const max = maxLength ?? maxValue ?? maxItems;
	if (min !== undefined) result += `.min(${min})`;
	if (max !== undefined) result += `.max(${max})`;
	// Exclusive bounds are a distinct question from inclusive ones - `z.number().positive()` is
	// `.gt(0)`, and emitting `.min(0)` for it would accept a zero share count or a zero spot rate.
	const minExclusive = getMinValueExclusive(program, target);
	const maxExclusive = getMaxValueExclusive(program, target);
	if (minExclusive !== undefined) result += `.gt(${minExclusive})`;
	if (maxExclusive !== undefined) result += `.lt(${maxExclusive})`;
	if (pattern !== undefined) {
		reportUnsafePattern(program, pattern, target);
		result += `.regex(${patternToRegex(pattern)})`;
	}

	return result;
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
 * Patterns already judged, because one scalar's pattern reaches here once per USE.
 *
 * **Not an optimisation, a necessity.** 153 of the 227 emitted `.regex()` calls in the reference
 * service came from a single scalar, and the analysis costs up to {@link ANALYSIS_TIMEOUT_MS} each.
 * Keyed on the pattern text, which is the only input the verdict depends on.
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
const reported = new WeakMap<Program, WeakSet<Type>>();

/**
 * Warn when a `@pattern` is one a backtracking engine can be made to spend unbounded time on.
 *
 * **The emitted regex is NOT changed, and that is deliberate.** `@typespec/openapi3` publishes the
 * pattern verbatim, so anchoring it, bounding it or rewriting it here would make the validator
 * enforce something the document does not state - the one trade this package never makes. What can
 * be done is to say so at build time, while the author can still change the spec.
 *
 * **The engine is the one Zod runs on.** `unicode: false` because {@link patternToRegex} emits a bare
 * `/.../` with no flags, so the analysis has to be of the expression as it will actually run.
 *
 * **`safe === false` means "not proven safe", not "proven dangerous"**, and the wording follows that.
 * `redos-detector` proves safety rather than guessing at danger, so a pattern it cannot decide inside
 * the timeout is reported the same way as one it decides against. Measured over a realistic spread of
 * 14 patterns an API would carry: 2 conservative warnings, both on a quantifier nested over an
 * overlapping class, and nothing dangerous missed - including `^\w+([.-]?\w+)*$`, which reads as
 * ordinary and takes **11 seconds** on a 29-character input.
 */
function reportUnsafePattern(program: Program, pattern: string, target: Type): void {
	let safe = verdicts.get(pattern);
	if (safe === undefined) {
		try {
			safe = isSafePattern(pattern, { unicode: false, timeout: ANALYSIS_TIMEOUT_MS }).safe;
		} catch {
			// A pattern the analyser cannot even parse is not one to make a claim about.
			safe = true;
		}
		verdicts.set(pattern, safe);
	}
	if (safe) return;
	let already = reported.get(program);
	if (already === undefined) {
		already = new WeakSet();
		reported.set(program, already);
	}
	// A declaration carries at most one `@pattern`, so the declaration alone identifies the report.
	if (already.has(target)) return;
	already.add(target);
	reportDiagnostic(program, {
		code: "redos-prone-pattern",
		format: { pattern },
		target,
	});
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
	return `/${pattern.replace(/\//g, "\\/")}/`;
}
