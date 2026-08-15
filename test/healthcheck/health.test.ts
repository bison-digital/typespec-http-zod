import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/** See `health.tsp`. The first spec a consumer writes, and it did not compile. */
const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
beforeAll(async () => {
	compiled = await compileFixture(here, "health", { outName: "healthcheck" });
}, 300_000);

describe("a service with nothing to flatten", () => {
	it("emits output that compiles, unused declarations included", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});
});
