import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { $lib, EmitterOptionsSchema } from "../src/index.js";

/**
 * **A user who hits a refusal should find it documented, not discover it.**
 *
 * **Documentation is asserted as a CLASS, the way every other rule here is.** A README listing the
 * diagnostics that existed when somebody last wrote it is a list that stops covering what the package
 * does, and the failure is silent - the reader concludes the emitter has no opinion about the thing
 * that just refused their spec.
 *
 * So a diagnostic or an option added later fails this suite until it is written down. That is the
 * whole mechanism: the cost of documenting is paid at the moment the capability is added, by the
 * person who knows why it exists.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
/** The options, diagnostics and limits moved here so the README could be a starting page. */
const reference = readFileSync(join(packageRoot, "docs", "reference.md"), "utf8");
const guides = readFileSync(join(packageRoot, "docs", "guides.md"), "utf8");

describe("the README documents everything this package can do to you", () => {
	it("has the documents the arms below read", () => {
		// Non-vacuity: every arm below passes trivially against an empty file.
		expect(readme.length).toBeGreaterThanOrEqual(2000);
		expect(reference.length).toBeGreaterThanOrEqual(2000);
		expect(guides.length).toBeGreaterThanOrEqual(2000);
		expect(reference).toMatch(/^## What it refuses, and why$/m);
		expect(reference).toMatch(/^## Options$/m);
		expect(reference).toMatch(/^## Known limits$/m);
	});

	/**
	 * A reference nothing points at is the failure mode of moving one out of the README. The arms
	 * below stop reading `README.md` for options and diagnostics, so nothing would notice the README
	 * ceasing to mention that these documents exist, and a reader arriving at the package would not
	 * find them.
	 *
	 * Asserted on the link target rather than on the prose, so rewording the sentence around it is
	 * free and deleting the link is not.
	 */
	it("links every document from the README", () => {
		const linked = [...readme.matchAll(/\]\((docs\/[\w./-]+?\.md)(?:#[\w-]+)?\)/g)].map(
			(match) => match[1],
		);
		expect([...new Set(linked)].toSorted()).toEqual([
			"docs/guides.md",
			"docs/oracles.md",
			"docs/reference.md",
		]);
	});

	it("names every diagnostic it can raise", () => {
		const codes = Object.keys($lib.diagnostics);
		/**
		 * **This floor has moved DOWN twice, 8 to 7 to 6, and that needs saying out loud.** Lowering a
		 * floor is normally how an arm rots into passing vacuously. Here the measured value genuinely
		 * fell each time, because a refusal turned out to refuse something representable and was retired:
		 * `circular-model` first, then `unsupported-scalar`. The floor tracks the count to keep the arm
		 * non-vacuous against an empty set; it is not a pin, because adding a diagnostic must not fail
		 * this arm - it must fail the one below, which requires it to be documented.
		 */
		expect(codes.length).toBeGreaterThanOrEqual(6);
		expect(codes.filter((code) => !reference.includes(`\`${code}\``)).toSorted()).toEqual([]);
	});

	it("names every option it accepts", () => {
		const options = Object.keys(EmitterOptionsSchema.properties ?? {});
		expect(options.length).toBeGreaterThanOrEqual(6);
		expect(options.filter((option) => !reference.includes(`\`${option}\``)).toSorted()).toEqual([]);
	});

	it("documents every diagnostic that has a call site, and declares none that has not", () => {
		/**
		 * **A declared diagnostic with no call site is coverage that does not exist.** It reads as a
		 * capability - the package refuses this thing - while nothing can ever raise it. Two of these
		 * sat here mid-extraction, both legitimately, because the code that reported them had not been
		 * carried across yet; asserting the class is what closed that window rather than leaving it to
		 * be noticed.
		 */
		const sources = ["api.ts", "zod.ts", "types.ts", "registry.ts", "constraints.ts", "emitter.ts"]
			.map((name) => {
				try {
					return readFileSync(join(packageRoot, "src", name), "utf8");
				} catch {
					return "";
				}
			})
			.join("\n");
		const unreachable = Object.keys($lib.diagnostics).filter(
			(code) => !sources.includes(`code: "${code}"`),
		);
		expect(unreachable.toSorted()).toEqual([]);
	});

	/**
	 * **`./runtime` is the only thing this package puts in an application's RUNTIME graph, and the
	 * README told readers to install it where a runtime import cannot resolve.**
	 *
	 * `npm install --save-dev typespec-http-zod` is correct for the emitter, which runs at build time,
	 * and correct for the generated files, which import `ResponseArm` as a TYPE and therefore erase. It
	 * is wrong the moment an application calls `armFor` - a function, and the one this package ships
	 * precisely so applications do not re-derive OpenAPI's response precedence by hand.
	 *
	 * Measured in a fresh project installed from a `pnpm pack` tarball, same build output both times:
	 * as a devDependency `node dist/run.js` exits **1** with
	 * `ERR_MODULE_NOT_FOUND: Cannot find package 'typespec-http-zod'`; moved to `dependencies`, **0**.
	 * Typecheck, build and `pnpm install` in development all pass in the failing case - deployment is
	 * the first thing that does not, which is why a reader cannot be left to find it.
	 *
	 * Keyed on whether `./runtime` exports a VALUE rather than on the current export list, so a package
	 * that later adds a second runtime function does not quietly reopen this.
	 */
	describe("the README tells a reader how to install what it tells them to import", () => {
		const runtime = readFileSync(join(packageRoot, "src", "runtime.ts"), "utf8");
		/** `export function` / `export const` / `export class` - the exports that survive to JavaScript. */
		const valueExports = [
			...runtime.matchAll(/^export (?:function|const|class|let|var) (\w+)/gm),
		].map((match) => match[1] ?? "");

		it("has runtime value exports to be wrong about", () => {
			// Non-vacuity: both arms below pass trivially against a types-only runtime module.
			expect(valueExports.length).toBeGreaterThanOrEqual(1);
		});

		it("does not tell the reader to install it as a dev dependency only", () => {
			const install = /```bash\n([^`]*)```/.exec(readme)?.[1] ?? "";
			expect(install).not.toBe("");
			expect(install).toContain("npm install typespec-http-zod");
			expect(install).not.toMatch(/--save-dev|-D\b/);
		});

		it("names every runtime value export, so the reader knows what needs resolving", () => {
			expect(valueExports.filter((name) => !readme.includes(`\`${name}\``)).toSorted()).toEqual([]);
		});
	});

	/**
	 * **The version being published must have a CHANGELOG entry, and this nearly shipped without
	 * one.** `0.1.0` was tagged in `package.json` while the changelog still read "Nothing is published
	 * yet. `0.1.0` will be the first release" - so the first thing a reader met on the npm page would
	 * have been a document saying the thing they had just installed did not exist.
	 *
	 * Keyed on `package.json`'s own version rather than on a literal, so the next bump fails this
	 * suite until it is written down - the same mechanism as the diagnostics and options above, and
	 * for the same reason: the cost of documenting is paid by the person who knows why.
	 */
	it("has a changelog entry for the version it is about to publish", () => {
		const changelog = readFileSync(join(packageRoot, "CHANGELOG.md"), "utf8");
		const { version } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
			version: string;
		};
		// Non-vacuity: a missing or empty changelog would otherwise pass the match below by accident.
		expect(changelog.length).toBeGreaterThanOrEqual(500);
		expect(version).toMatch(/^\d+\.\d+\.\d+/);
		expect(changelog).toMatch(new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m"));
	});

	it("states each counted-but-ungraded surface as a limit, with its number", () => {
		/**
		 * **A number in a baseline file is not a stated limitation.** Inside a private package these
		 * are honest, visible counters; published, they are surfaces a reader has no way to learn about.
		 * So each one is named in the README, and this arm checks the numbers there against the numbers
		 * the suite actually measured - a limit documented with a stale figure is worse than none.
		 */
		const baseline = JSON.parse(
			readFileSync(join(packageRoot, "test", "conformance", "baseline.json"), "utf8"),
		) as {
			unenforcedFormats: number;
			negotiatedResponseBodies: number;
			unreadableResponseBodies: number;
		};
		expect(reference).toMatch(
			new RegExp(`\\b${baseline.unenforcedFormats}\\b.{0,40}annotations`, "s"),
		);
		expect(reference).toMatch(
			new RegExp(`\\b${baseline.negotiatedResponseBodies}\\b negotiated response bodies`, "s"),
		);
		expect(reference).toMatch(
			new RegExp(`\\b${baseline.unreadableResponseBodies}\\b response bodies reduce`, "s"),
		);
		/**
		 * **A limit that has been CLOSED must stop being listed.** A README describing a gap that no
		 * longer exists is the same defect as one omitting a gap that does: both leave the reader with a
		 * wrong model, and the stale direction is the one nobody goes looking for.
		 */
		expect(reference).not.toMatch(/`content-type` and `accept` request validators are not graded/);
		expect(reference).not.toMatch(
			/response bodies are read by status but not resolved to a component/,
		);
	});
});
