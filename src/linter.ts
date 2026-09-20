import { defineLinter, type LinterDefinition } from "@typespec/compiler";
import { redosPronePatternRule } from "./rules/redos-prone-pattern.rule.js";

/**
 * **The advisory checks, opt-in, as TypeSpec expects them.**
 *
 * Enabled from a consumer's `tspconfig.yaml` with `linter: { extends: ["typespec-http-zod/recommended"] }`.
 * A consumer of `typespec-hono` enables the same rule through that package's own ruleset instead,
 * because it never loads this package as a TypeSpec library and so cannot name it there.
 */
/**
 * Typed explicitly through this package's own `@typespec/compiler` specifier. A checkout beside
 * `typespec-hono` resolves two copies of the compiler, and an INFERRED declaration type can then
 * name the other package's copy by a `.pnpm` path (`TS2883`, "likely not portable"), which is
 * broken for everyone who installed differently. `typespec-hono` hit exactly that on its own linter.
 */
export const $linter: LinterDefinition = defineLinter({
	rules: [redosPronePatternRule],
	ruleSets: {
		recommended: {
			enable: { [`typespec-http-zod/${redosPronePatternRule.name}`]: true },
		},
	},
});
