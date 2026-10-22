import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A per-service `seal-object-schemas` that `@typespec/openapi3` cannot mirror is refused.**
 *
 * The option exists because two emitters answer the same question about the same models and neither
 * can read the other's configuration, so it is stated twice and they must agree - its own docblock
 * says so. **`@typespec/openapi3` has no per-service options.** One value covers the whole program.
 *
 * So a value that differs per service cannot be mirrored: whichever way openapi3 is configured, at
 * least one service publishes a document that disagrees with the validator generated beside it.
 * Sealed here and silent there would 400 a payload the document permits; the reverse publishes a
 * strictness the runtime does not enforce. Both are the divergence this emitter exists to prevent,
 * and both were previously accepted without a word.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a per-service seal that the document cannot mirror", () => {
	it("is refused when one service disagrees with the top level", async () => {
		const compiled = await compileFixture(here, "sealing", {
			outName: "sealing-split",
			extraOptions: {
				"seal-object-schemas": false,
				services: { Alpha: { "seal-object-schemas": true } },
			},
		});
		const refusals = compiled.diagnostics.filter((d) => d.code.endsWith("unmirrorable-seal"));
		expect(refusals.length, JSON.stringify(compiled.diagnostics)).toBeGreaterThan(0);
		expect(refusals[0]?.severity).toBe("error");
	});

	it("is refused when two services disagree with each other", async () => {
		const compiled = await compileFixture(here, "sealing", {
			outName: "sealing-pair",
			extraOptions: {
				services: {
					Alpha: { "seal-object-schemas": true },
					Beta: { "seal-object-schemas": false },
				},
			},
		});
		const refusals = compiled.diagnostics.filter((d) => d.code.endsWith("unmirrorable-seal"));
		expect(refusals.length, JSON.stringify(compiled.diagnostics)).toBeGreaterThan(0);
	});

	/**
	 * The control. Stating the same value per service is redundant but not wrong, and a rule that
	 * fired on it would push consumers away from being explicit - the opposite of what this option
	 * wants, since the whole point is that the value is stated twice on purpose.
	 */
	it("permits a per-service value that agrees with the top level", async () => {
		const compiled = await compileFixture(here, "sealing", {
			outName: "sealing-agree",
			extraOptions: {
				"seal-object-schemas": true,
				services: {
					Alpha: { "seal-object-schemas": true },
					Beta: { "seal-object-schemas": true },
				},
			},
		});
		const refusals = compiled.diagnostics.filter((d) => d.code.endsWith("unmirrorable-seal"));
		expect(refusals, JSON.stringify(compiled.diagnostics)).toEqual([]);
	});

	it("permits the ordinary case, where nothing is stated per service", async () => {
		const compiled = await compileFixture(here, "sealing", {
			outName: "sealing-plain",
			extraOptions: { "seal-object-schemas": true },
		});
		const refusals = compiled.diagnostics.filter((d) => d.code.endsWith("unmirrorable-seal"));
		expect(refusals, JSON.stringify(compiled.diagnostics)).toEqual([]);
	});
});
