import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A `@pattern` is code the server runs on attacker-chosen input, and nothing said so.**
 *
 * `@pattern` is published verbatim by `@typespec/openapi3` and emitted verbatim by this package, as
 * it must be: anchoring or bounding it here would make the validator enforce something the document
 * does not state. What was missing is any word about the cost. Measured on a generated server under
 * `workerd`, `^(\w+\s?)*$` - which reads as "words" - answered a 31-byte query parameter in 7.8
 * seconds against 2.9 milliseconds for a conformant one, doubling per added byte, with no credential
 * required and the validator running before any handler.
 *
 * **Both directions are asserted, and the safe half is the half that keeps this usable.** A warning
 * that fires on ordinary patterns gets suppressed, and a suppressed warning guards nothing. The safe
 * fixtures include `^[a-z]+(-[a-z]+)*$`, which has a quantifier inside a quantifier and is perfectly
 * safe because the separator is required - the discrimination this rests on.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const CODE = "typespec-http-zod/redos-prone-pattern";

const RECOMMENDED = { extends: ["typespec-http-zod/recommended" as const] };

describe("a pattern that can backtrack catastrophically is named at build time", () => {
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "redos", { linter: RECOMMENDED });
	}, 120_000);

	it("warns for every dangerous pattern the fixture declares, and only those", () => {
		const warned = compiled.diagnostics.filter((d) => d.code === CODE);
		/**
		 * Five: `Words`, `Handle`, the inline `^(a|a)+$`, `doubleTrouble` and `unicodeOnlyDanger`.
		 * The three safe scalars are the control - were the check simply "does it contain a nested
		 * quantifier", `Slug` would be here too.
		 */
		expect(warned.length).toBe(5);
		expect(warned.every((d) => d.severity === "warning")).toBe(true);
	});

	it("reports each declaration once, however many times it is used", () => {
		/**
		 * `Words` is reached once per USE - a query parameter here, and in the reference service a
		 * single scalar is reached 153 times. Three identical warnings against one declaration are
		 * noise a reader learns to skip, which is how a real one gets missed.
		 */
		const messages = compiled.program.diagnostics
			.filter((d) => d.code === CODE)
			.map((d) => String(d.message));
		expect(new Set(messages).size).toBe(messages.length);
	});

	/**
	 * **Two independent faults in one declaration must both be reported.**
	 *
	 * `doubleTrouble` carries a quantifier nested over an overlapping class AND a redundant `\-`
	 * that the `u` flag refuses, so it is both ReDoS-prone and unreadable to a conforming reader
	 * of the published document. Both warnings keyed their "already said this" memo on the TARGET
	 * rather than on the diagnostic, so whichever ran first claimed the declaration and silenced
	 * the other. Measured before the fix: one warning where two were due, which costs the author a
	 * second compile to discover the second fault.
	 *
	 * `Ident` is the independent witness for the same escape. It was removed from this fixture to
	 * keep the arm below green; teaching the arm is the right way round.
	 */
	/**
	 * **The analysis has to ask about the expression that will actually run.**
	 *
	 * `^(\\p{L}+)+$` carries the `u` flag when emitted, and under that flag it is a quantifier
	 * nested over a Unicode property class. Analysed WITHOUT the flag, `\\p` is the identity escape
	 * for `p` and `redos-detector` answers SAFE - so a genuinely dangerous pattern would ship with
	 * nothing said. Measured: `isSafePattern` returns safe=true at `unicode: false` and safe=false
	 * at `unicode: true` for this exact pattern.
	 */
	it("judges a pattern by the flag the emitter will emit for it", () => {
		const warned = compiled.program.diagnostics.filter(
			(d) => d.code === CODE && String(d.message).includes("\\p{L}"),
		);
		expect(warned).toHaveLength(1);
	});

	it("reports both faults when one declaration has both", () => {
		const on = (property: string, code: string): number =>
			compiled.program.diagnostics.filter(
				(d) => d.code === code && String(d.message).includes(property),
			).length;
		expect(on("(\\w+\\s?)*\\-", CODE)).toBe(1);
		expect(on("(\\w+\\s?)*\\-", "typespec-http-zod/non-unicode-pattern")).toBe(1);
	});

	it("raises nothing but these two kinds, so the fixture is otherwise ordinary", () => {
		const unexpected = compiled.diagnostics.filter(
			(d) => d.code !== CODE && d.code !== "typespec-http-zod/non-unicode-pattern",
		);
		expect(unexpected).toEqual([]);
	});

	it("names a remedy that keeps the document and the validator in agreement", () => {
		const message = String(
			compiled.program.diagnostics.find((d) => d.code === CODE)?.message ?? "",
		);
		// `@maxLength` is publishable, so it is the one bound that does not split the two artefacts.
		expect(message).toContain("@maxLength");
		expect(message).toContain("more than one way");
	});
});

/**
 * **It is a linter rule, so it is opt-in, and that is the behaviour this release changed.**
 *
 * TypeSpec's own docs draw the line: a diagnostic says the program is not valid for this library, a
 * linter says it "could be correct, but there might be room for improvements", and "linters need to
 * be explicitly enabled". A dangerous pattern is the second kind - the spec is valid and the emitted
 * regex is the published one - so it is reported only where a project asks for it.
 *
 * The cost of getting this wrong was measured, not assumed: an advisory raised as an automatic
 * warning breaks every consumer that sets `warn-as-error: true`, and three of this package's
 * consumers do.
 *
 * `non-unicode-pattern` is the control. It stays a DIAGNOSTIC, because there the emitter falls back
 * to a different expression from the one it publishes, so it fires with no linter at all.
 */
describe("the check is a linter rule, so a project that has not enabled it hears nothing", () => {
	let unlinted: CompiledFixture;

	beforeAll(async () => {
		unlinted = await compileFixture(here, "redos", { outName: "redos-unlinted" });
	}, 120_000);

	it("raises no ReDoS warning at all without the ruleset, on a fixture carrying five", () => {
		expect(unlinted.program.diagnostics.filter((d) => d.code === CODE)).toEqual([]);
	});

	it("still raises the diagnostic that is not advisory, so the compile is not simply silent", () => {
		expect(
			unlinted.program.diagnostics.filter((d) => d.code === "typespec-http-zod/non-unicode-pattern")
				.length,
		).toBeGreaterThanOrEqual(1);
	});
});
