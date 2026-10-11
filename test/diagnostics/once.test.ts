import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/** **One cause, one diagnostic.** See `once.tsp`. */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a response both walks read is diagnosed once", () => {
	it("raises unsupported-status-code-range once with contracts emitted", async () => {
		// The fixture compiler emits contracts, so both walks run.
		const compiled = await compileFixture(here, "once");
		const raised = compiled.diagnostics.filter(
			(diagnostic) => diagnostic.code === "typespec-http-zod/unsupported-status-code-range",
		);
		expect(raised).toHaveLength(1);
	}, 120_000);
});
