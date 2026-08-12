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

/**
 * Constraint decorators → the Zod modifiers that enforce them.
 *
 * These are **first-party** TypeSpec decorators (`@minLength`, `@pattern`, …), which matters twice
 * over: the spec author writes standard TypeSpec rather than a dialect, and `@typespec/openapi3`
 * documents them without any help from us.
 *
 * ⚠️ **`@refine` is the ONE that is still ours, and it is on its way out.** It is not a constraint —
 * it is an arbitrary predicate, which a type language has no way to say and therefore no document
 * can publish, so a validator enforcing it enforces something no caller can read. `@trimmed` was the
 * other one and is gone: `.trim()` is a transform, and transforming a value before validating it
 * makes the runtime accept inputs the published contract rejects. The spec states `@pattern`
 * instead, which openapi3 publishes.
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
	// Exclusive bounds are a distinct question from inclusive ones — `z.number().positive()` is
	// `.gt(0)`, and emitting `.min(0)` for it would accept a zero share count or a zero spot rate.
	const minExclusive = getMinValueExclusive(program, target);
	const maxExclusive = getMaxValueExclusive(program, target);
	if (minExclusive !== undefined) result += `.gt(${minExclusive})`;
	if (maxExclusive !== undefined) result += `.lt(${maxExclusive})`;
	if (pattern !== undefined) result += `.regex(${patternToRegex(pattern)})`;

	return result;
}

/**
 * A `@pattern` string becomes a regex literal — **verbatim**.
 *
 * ⚠️ **This used to add anchors, and that was wrong twice over.**
 *
 * The docblock claimed "TypeSpec's `@pattern` is a full-match assertion (it follows JSON Schema)".
 * JSON Schema says the opposite, in as many words: *"Recall: regular expressions are not implicitly
 * anchored"* (2020-12 validation, `pattern`). So the document published one expression and the
 * validator enforced another, and the caller who read the document was the one who got the 400.
 *
 * Worse, the anchoring was not even an anchoring. `^` and `$` bind looser than `|`, so a top-level
 * alternation changed meaning rather than being constrained: the spec's `\S|^$` became `^\S|^$`,
 * which is `(^\S)|(^$)` — "starts with a non-space, or is empty". Measured on `"  Alex  "` the
 * document said valid and we rejected; on `"Alex  "` we accepted what the pattern's own stated
 * intent forbids. 153 of the 227 emitted `.regex()` calls came from that one scalar.
 *
 * A pattern that means to match the whole string says so in the spec — `^\S(?:[\s\S]*\S)?$`, which
 * is the standard construct for it. That way the document and the validator carry
 * the identical expression, and the conformance differential can assert it character for character
 * instead of guessing at an equivalence.
 */
export function patternToRegex(pattern: string): string {
	return `/${pattern.replace(/\//g, "\\/")}/`;
}
