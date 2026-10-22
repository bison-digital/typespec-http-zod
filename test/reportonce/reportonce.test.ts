import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A diagnostic is reported once per declaration, however many copies of it the compiler makes.**
 * See `reportonce.tsp`.
 *
 * The memo was keyed on the type object, and the compiler hands out a new one for every copy of a
 * declaration: `model B is A`, a spread into each operation, and a versioning projection per emitter.
 * Measured before the change: `unsatisfiable-encoding` twice through `model B is A` and twice through
 * a spread shared by two operations, and every diagnostic twice when `typespec-hono` and this emitter
 * compiled one versioned service.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

const EXPECTED = [
	"typespec-http-zod/never-body",
	"typespec-http-zod/unenforceable-encoded-constraint",
	"typespec-http-zod/unsatisfiable-encoding",
	"typespec-http-zod/unsatisfiable-encoding",
];

describe("a declaration reached through its copies", () => {
	it("is reported once, through `model B is A`, a shared spread and a versioned service", async () => {
		const compiled = await compileFixture(here, "reportonce", { outName: "reportonce" });
		expect(compiled.diagnostics.map((d) => d.code).toSorted()).toEqual(EXPECTED);
	}, 300_000);

	it("is reported once when two emitters built on this library compile it together", () => {
		// A plain Node process, so the compiler and both emitters share one copy of this library, as
		// a consumer's `tsp compile` does; vitest would load a second one.
		const output = execFileSync(process.execPath, [join(here, "two-emitters.mjs")], {
			encoding: "utf8",
		});
		const counts = JSON.parse(output.trim().split("\n").at(-1) ?? "{}") as Record<string, number>;
		expect(
			Object.keys(counts)
				.map((key) => key.split(" ")[0])
				.toSorted(),
		).toEqual(EXPECTED);
		expect(Object.values(counts)).toEqual([1, 1, 1, 1]);
	}, 300_000);
});
