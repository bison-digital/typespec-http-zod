import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A construct the document cannot express honestly is REFUSED, not compensated for.**
 *
 * This emitter once injected the missing discriminator itself. The validator was right, the document
 * was wrong, and the gap was booked as a "declared divergence" — a warning on the union, a committed
 * list in the baseline, a citation of the OpenAPI rule openapi3 breaks. All of that was true, and
 * all of it beside the point: it enforced a rule no published contract stated, which is the same
 * defect as the `@refine` predicate this effort exists to delete. Being right about the wire does
 * not license inventing runtime behaviour, and a label on a custom track does not stop it being one.
 *
 * So it refuses, and the refusal names the one-line fix in the spec. Nothing waits on anybody.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a discriminator the document cannot publish is refused", () => {
	it("reports undeclared-discriminator as an ERROR, and compensates for nothing", async () => {
		const compiled = await compileFixture(here, "undeclared");
		// An error, not a warning. A warning is what let the compensating validator ship last time.
		expect(
			compiled.diagnostics.filter((diagnostic) =>
				diagnostic.code.endsWith("undeclared-discriminator"),
			),
		).toEqual([{ code: "typespec-http-zod/undeclared-discriminator", severity: "error" }]);
	});

	it("raises no WARNING-level diagnostic of its own anywhere", async () => {
		/**
		 * The general form of the rule, and the reason this arm outlives the case above. A warning from
		 * this emitter would mean "the output is knowingly not what the document says, and we are
		 * shipping it anyway" — the exact compromise that was just removed. There should be none.
		 */
		const compiled = await compileFixture(here, "undeclared");
		const ours = compiled.diagnostics.filter(
			(diagnostic) =>
				diagnostic.code.startsWith("typespec-http-zod/") && diagnostic.severity === "warning",
		);
		expect(ours).toEqual([]);
	});
});
