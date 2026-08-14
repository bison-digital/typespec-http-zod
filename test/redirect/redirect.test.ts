import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * See `redirect.tsp` for what this is about and why it was invisible.
 *
 * Measured before the change: **zero** operations in the whole conformance corpus declare a response
 * set without a 2xx, which is why nothing caught it and why the fix cannot move an existing baseline.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let compiled: CompiledFixture;
let schemas: string;

beforeAll(async () => {
	compiled = await compileFixture(here, "redirect", { outName: "redirect" });
	schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
}, 300_000);

describe("an operation whose only response is a redirect", () => {
	it("compiles without an error of ours", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("emits the ordinary operation, so the arm below cannot pass on an empty emit", () => {
		expect(schemas).toContain("thingResponses");
	});

	it("emits the redirect operation rather than dropping it", () => {
		expect(schemas, "the redirect operation was dropped").toContain("goResponses");
	});

	it("carries the status the document declares", () => {
		expect(schemas).toMatch(/goResponses = \[\{ status: 302/);
	});

	it("declares each status ONCE, so no arm shadows another", () => {
		/**
		 * **A redirect was emitted twice**: once as the primary arm, carrying its headers, and once as
		 * a failure arm, carrying none. `errorArmsOf` excludes 2xx from the failure arms, so widening
		 * the primary to include 3xx put a 302 in both. Anything taking the first match got the right
		 * arm by luck of ordering, and anything scanning got a second arm claiming no headers.
		 */
		const arms = /goResponses = (\[[\s\S]*?\]) satisfies/.exec(schemas)?.[1] ?? "";
		expect(arms, "no arms found, so this compares nothing").not.toBe("");
		const statuses = [...arms.matchAll(/status: ([^,}]+)/g)].map((m) => (m[1] ?? "").trim());
		expect(statuses.length).toBeGreaterThanOrEqual(1);
		expect(statuses).toEqual([...new Set(statuses)]);
	});
});
