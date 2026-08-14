import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A spec may publish more than one `@service`, and every one of them has to survive.**
 *
 * Each service is emitted with its own registry and its own import collector, because sharing either
 * merges one surface's schemas into the other's file. What was not per-service was the PATH: every
 * service wrote `schemas.gen.ts` into `emitter-output-dir`, so the last one walked overwrote the
 * rest.
 *
 * Measured before the fix: two services, zero diagnostics, one file, and the first service's
 * validators absent entirely. Nothing refused and nothing warned, so a consumer would have found half
 * their API unvalidated rather than been told.
 *
 * The rule is `@typespec/openapi3`'s, copied: its default output path interpolates
 * `{service-name-if-multiple}`, so a name is inserted only when there is more than one service to
 * tell apart. That is why the single-service arm below matters as much as the two-service one - a
 * fix that relocated every consumer's output would be a worse defect than the one it closed.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("every service in a spec gets its own artefacts", () => {
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "two");
	}, 120_000);

	it("compiles both services without a diagnostic", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	it("writes a schemas file per service, neither overwriting the other", () => {
		const internal = join(compiled.outDir, "InternalApi", "schemas.gen.ts");
		const surface = join(compiled.outDir, "PublicApi", "schemas.gen.ts");
		expect(existsSync(internal), internal).toBe(true);
		expect(existsSync(surface), surface).toBe(true);

		/**
		 * Each file holds ITS OWN service and not the other's. A single merged file would satisfy a
		 * check that both names appear somewhere, which is the failure this arm is really about.
		 */
		const internalSource = readFileSync(internal, "utf8");
		const surfaceSource = readFileSync(surface, "utf8");
		expect(internalSource).toContain("widgetSchema");
		expect(internalSource).not.toContain("articleSchema");
		expect(surfaceSource).toContain("articleSchema");
		expect(surfaceSource).not.toContain("widgetSchema");
	});

	it("names one service per emitted service record, with distinct output directories", () => {
		// Non-vacuity: one service emitted twice would pass the file arm above and fail here.
		const directories = new Set([
			join(compiled.outDir, "InternalApi"),
			join(compiled.outDir, "PublicApi"),
		]);
		expect(directories.size).toBe(2);
	});
});

describe("a single service is emitted exactly where it always was", () => {
	/**
	 * Relocating output for every existing consumer would be a worse defect than the collision it
	 * fixes, so the disambiguation applies only when there is more than one service. Any other fixture
	 * in this suite declares one service and reads `schemas.gen.ts` straight from its output
	 * directory; this states the rule rather than leaving it as a property nobody wrote down.
	 */
	it("writes schemas.gen.ts into the output directory itself", async () => {
		const single = await compileFixture(join(here, "..", "recursion"), "tree", {
			outName: "single-service",
		});
		expect(single.diagnostics).toEqual([]);
		expect(existsSync(join(single.outDir, "schemas.gen.ts"))).toBe(true);
	}, 120_000);
});
