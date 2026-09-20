import {
	type CallableMessage,
	createRule,
	getPattern,
	type LinterRuleDefinition,
	type ModelProperty,
	paramMessage,
	type Scalar,
} from "@typespec/compiler";
import { patternIsProvablySafe } from "../constraints.js";

/**
 * **A `@pattern` a backtracking engine can be made to spend unbounded time on.**
 *
 * **A linter rule, because TypeSpec's own definition puts it there.** A diagnostic says the program
 * is not valid for this library; a linter says it "could be correct, but there might be room for
 * improvements", and has to be enabled explicitly. Here the spec is valid, the document is correct,
 * and the emitted regex is exactly the one `@typespec/openapi3` publishes. What is wrong is a cost no
 * artefact states. `@typespec/http` puts its own advisory rule in a linter for the same reason.
 *
 * **This is a server-side denial of service, not a style note.** Measured on a generated server
 * under `workerd`: `@pattern("^(\w+\s?)*$")`, which reads as "words", answers a 31-byte query
 * parameter in 7.8 seconds against 2.9 milliseconds for a conformant one, and the cost doubles per
 * added byte. The caller needs no credential and the parameter is validated before any handler runs.
 * That is why the package's `recommended` ruleset enables it, and why the documentation says to.
 *
 * **The emitted regex is not changed, and cannot be.** Anchoring or bounding it here would make the
 * validator enforce something the document does not state. What is left is to say so while the author
 * can still change the spec.
 *
 * **Reported once per DECLARATION.** A linter walks declarations rather than uses, so a scalar used
 * in 153 places is one report - and an instantiated template's properties share their declaration's
 * node, which is what the de-duplication keys on.
 */
export const redosPronePatternRule: LinterRuleDefinition<
	"redos-prone-pattern",
	{ readonly default: CallableMessage<["pattern"]> }
> = createRule({
	name: "redos-prone-pattern",
	severity: "warning",
	description: "Flag a @pattern that cannot be proven safe against catastrophic backtracking.",
	messages: {
		default: paramMessage`'${"pattern"}' cannot be proven safe against catastrophic backtracking: one input can match it more than one way, so a caller can choose a value that takes exponentially long to reject. The emitted validator runs it on every request, before any handler, and the pattern is published verbatim so it cannot be rewritten for you. Remove the ambiguity, usually by taking out a quantifier nested inside another or an optional separator between repeated groups, or add a SMALL '@maxLength' to bound the work.`,
	},
	create(context) {
		const seen = new WeakSet<object>();
		const check = (target: Scalar | ModelProperty): void => {
			const pattern = getPattern(context.program, target);
			if (pattern === undefined || patternIsProvablySafe(pattern)) return;
			const declaration = target.node ?? target;
			if (seen.has(declaration)) return;
			seen.add(declaration);
			context.reportDiagnostic({ format: { pattern }, target });
		};
		return { scalar: check, modelProperty: check };
	},
});
