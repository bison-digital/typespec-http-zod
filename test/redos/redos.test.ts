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

describe("a pattern that can backtrack catastrophically is named at build time", () => {
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "redos");
	}, 120_000);

	it("warns for every dangerous pattern the fixture declares, and only those", () => {
		const warned = compiled.diagnostics.filter((d) => d.code === CODE);
		/**
		 * Three: `Words`, `Handle` and the inline `^(a|a)+$`. The three safe scalars are the control -
		 * were the check simply "does it contain a nested quantifier", `Slug` would be here too.
		 */
		expect(warned.length).toBe(3);
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

	it("raises nothing else, so the fixture is otherwise ordinary", () => {
		expect(compiled.diagnostics.filter((d) => d.code !== CODE)).toEqual([]);
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
