import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScenario, discoverScenarios } from "../conformance/corpus.js";
import { compileFixture } from "./compile-fixture.js";

/**
 * **A deterministic set of emitted output, compiled by the suite that grades it.**
 *
 * **This exists because three separate oracles graded whatever `.gen.ts` files happened to be on
 * disk.** `vocabulary.test.ts` and `packaging.test.ts` each walked `test/` for emitted output - output
 * written by OTHER test files. Vitest runs test files in parallel and nothing ordered them, so both
 * suites read whatever the previous run left behind. Measured, and reproducible in both directions:
 *
 * - **clean tree -> RED.** `pnpm test` on a fresh checkout failed with every floor at 0, because the
 *   files did not exist yet when those suites ran - and a fresh clone is precisely what CI runs.
 * - **populated tree -> GREEN.** A second consecutive run passes by grading the *previous* build. A
 *   control that deleted a fix from `src/` passed green here, while the output on disk afterwards
 *   contained none of it. A guard that grades the previous build is worse than no guard: it reports
 *   agreement about something that has stopped being true.
 *
 * **Each caller gets its OWN directory, and that is not tidiness.** Two suites compiling one
 * fixture into one directory with different options overwrite each other - the failure that once made
 * the same request answer 400, 200 and 204 across three runs of an unchanged emitter. The `outName`
 * parameter is what keeps callers from racing.
 */

// `../..` because this file lives in `test/support/`, where `..` is `test/` and not the root.
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The fixtures compiled for these sweeps, chosen to carry the widest vocabulary in the package:
 * every constraint keyword, both encodings, multipart, polymorphism, recursion, streaming, unions,
 * and every transport encoding that needs decoding.
 */
export const VOCABULARY_FIXTURES: readonly (readonly [dir: string, name: string])[] = [
	["encoding", "wire"],
	["inheritance", "buildings"],
	["multipart", "upload"],
	["polymorphism", "zoo"],
	["recursion", "tree"],
	["recursion", "union-cycle"],
	["reference", "constraints"],
	["reference", "service"],
	["reference", "wire"],
	["streaming", "feed"],
	["unions", "pets"],
	["unions", "undeclared"],
	// Multipart parts read as a list's JSON or its elements, and text parts read as a form's field.
	["declarationviews/forms", "fj-json-list-parts"],
	["declarationviews/forms", "fu-text-union-lists"],
];

/** Every `.gen.ts` under a directory. */
export function generatedFilesUnder(root: string): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry.endsWith(".gen.ts")) found.push(full);
		}
	};
	walk(root);
	return found;
}

/**
 * Compile {@link VOCABULARY_FIXTURES} into a directory of this caller's own and hand back what landed.
 *
 * `outName` must be unique per suite - see the docblock above for what sharing one costs.
 */
export async function compileEmittedSet(outName: string): Promise<string[]> {
	const outputRoot = join(packageRoot, "test", `.out-${outName}`);
	rmSync(outputRoot, { recursive: true, force: true });
	for (const [dir, name] of VOCABULARY_FIXTURES) {
		await compileFixture(join(packageRoot, "test", dir), name, {
			outDir: join(outputRoot, `${dir}__${name}`),
		});
	}
	/**
	 * **The whole corpus as well, and not only the local fixtures.**
	 *
	 * A sweep that walks `test/` happens to include every corpus scenario - broad, but grading
	 * whatever the previous run left on disk. Compiling only the local fixtures keeps the determinism
	 * and drops the breadth, and lowering a floor to fit reduced coverage is how a guard stops
	 * guarding. So the corpus is compiled here too, into this caller's own directory: deterministic AND
	 * wide.
	 */
	for (const scenario of discoverScenarios()) {
		try {
			await compileScenario(scenario, join(outputRoot, "corpus"));
		} catch {
			// A scenario that cannot compile is the differential's question, not this sweep's.
		}
	}
	return generatedFilesUnder(outputRoot);
}
