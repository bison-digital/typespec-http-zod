import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **The banner tells a reader how to regenerate the file, and only the project knows the command.**
 *
 * Every generated file opens with `DO NOT EDIT`, which says what not to do and not what to do
 * instead. The generic line that followed lost the "run this to regenerate" a reader actually needs,
 * and no emitter can know whether that is `pnpm generate`, `npm run api` or a `tsp compile` with
 * three flags. Reported by a consumer who had it and lost it.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

/** Every generated file's first three lines, so the assertion is about ALL of them. */
function banners(outDir: string): string[] {
	return readdirSync(outDir)
		.filter((name) => name.endsWith(".gen.ts"))
		.map((name) => readFileSync(join(outDir, name), "utf8").split("\n").slice(0, 3).join("\n"));
}

describe("the generated banner", () => {
	it("carries a regeneration command when the project states one", async () => {
		const compiled = await compileFixture(here, "banner", {
			outName: "banner-hint",
			extraOptions: { "regenerate-hint": "pnpm run generate:api" },
		});
		const found = banners(compiled.outDir);
		// Non-vacuity: there must be files to inspect, and EVERY one must carry it.
		expect(found.length).toBeGreaterThanOrEqual(2);
		for (const banner of found) {
			expect(banner).toContain("pnpm run generate:api");
			expect(banner).toContain("DO NOT EDIT");
		}
	});

	it("falls back to the generic line when the project states none", async () => {
		const compiled = await compileFixture(here, "banner", { outName: "banner-default" });
		const found = banners(compiled.outDir);
		expect(found.length).toBeGreaterThanOrEqual(2);
		for (const banner of found) {
			expect(banner).toContain("DO NOT EDIT");
			expect(banner).toContain("Recompile the spec");
		}
	});
});
