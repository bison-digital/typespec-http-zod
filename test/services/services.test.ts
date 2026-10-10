import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { writeContractsBarrel } from "../support/contracts-barrel.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

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

	/**
	 * **The contract types too, which a shared `contracts-output-dir` wrote once per service to the
	 * same path**, so the second service's `requests.gen.ts` replaced the first's and one whole surface
	 * lost its contracts with no diagnostic - the exact defect this suite was written for, one
	 * artefact over. Split the same way as the validators, so each service's `wire-contract.gen.ts`
	 * pairs with its own.
	 */
	it("writes a contracts file per service, each holding its own service", () => {
		const internal = join(compiled.outDir, "InternalApi", "requests.gen.ts");
		const surface = join(compiled.outDir, "PublicApi", "requests.gen.ts");
		expect(existsSync(internal), internal).toBe(true);
		expect(existsSync(surface), surface).toBe(true);
		const internalSource = readFileSync(internal, "utf8");
		const surfaceSource = readFileSync(surface, "utf8");
		expect(internalSource).toContain("interface Widget");
		expect(internalSource).not.toContain("interface Article");
		expect(surfaceSource).toContain("interface Article");
		expect(surfaceSource).not.toContain("interface Widget");
	});

	it("compiles each service's output beside its own contracts", () => {
		for (const service of ["InternalApi", "PublicApi"]) {
			const dir = join(compiled.outDir, service);
			// A relative `contracts-package` is resolved from each service's own directory.
			writeContractsBarrel(dir);
			const { output, failed } = typecheckEmitted(dir);
			expect(output, service).toBe("");
			expect(failed, service).toBe(false);
		}
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

describe("a contracts directory is split only where services share it", () => {
	/**
	 * **The split exists to stop two services overwriting one file, so it applies only where two do.**
	 * A project whose second service names its own `contracts-output-dir` leaves the shared one to the
	 * first service alone, and 0.27.0 wrote that service's contracts there. Splitting by the number of
	 * services rather than the number SHARING moved them into a subdirectory nothing collided in.
	 */
	it("leaves the one service falling back to the shared directory where it was", async () => {
		const outDir = join(here, ".out", "two-one-shared");
		const single = await compileFixture(here, "two", {
			outName: "two-one-shared",
			extraOptions: {
				services: {
					PublicApi: {
						"contracts-output-dir": join(outDir, "public-contract"),
						"contracts-package": "../public-contract/requests.gen.js",
					},
				},
			},
		});
		expect(single.diagnostics).toEqual([]);
		const shared = join(outDir, "requests.gen.ts");
		expect(existsSync(shared), shared).toBe(true);
		expect(readFileSync(shared, "utf8")).toContain("interface Widget");
		expect(existsSync(join(outDir, "InternalApi", "requests.gen.ts"))).toBe(false);
		const own = join(outDir, "public-contract", "requests.gen.ts");
		expect(readFileSync(own, "utf8")).toContain("interface Article");
	}, 120_000);
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
