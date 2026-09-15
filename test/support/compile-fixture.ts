import { rmSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_BARREL_SPECIFIER, writeContractsBarrel } from "./contracts-barrel.js";
import { compile, NodeHost, type Program } from "@typespec/compiler";

/**
 * Compile one `.tsp` fixture with this emitter, and hand back where it landed.
 *
 * Shared rather than copied into each suite. A second copy of this is how two artefacts came to quote
 * the identifier-quoting regex differently, and the settings below are the load-bearing part:
 * **sealing must be on**, or every strictness assertion downstream is vacuous, and the contract types
 * have to be written beside the schemas or the emitted module imports a package that does not exist
 * here and cannot be loaded from a test at all.
 */
export interface CompiledFixture {
	readonly outDir: string;
	readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
	/**
	 * The compiled program, so a suite can ask the published API what it produced rather than only
	 * reading the files it wrote. `EmittedRoute` carries facts that reach a consumer without appearing
	 * in any emitted file - `requestContentTypes` among them - and those were graded by nothing.
	 */
	readonly program: Program;
}

export interface FixtureOptions {
	/**
	 * Where the emitted Zod and wire assertions import their shared types from. The default points at
	 * the vocabularies module alone, which is enough for a suite that only loads the schemas - but
	 * `wire-contract.gen.ts` names request types too, so under the default it references members that
	 * module does not export and **cannot compile**. A suite that compiles the whole emitted set has
	 * to supply a barrel over both, the way a real consumer's contracts package is one.
	 */
	readonly contractsPackage?: string;
	readonly keyVocabularies?: readonly string[];
	/** Anything else the emitter accepts, for an option a single suite exercises. */
	readonly extraOptions?: Readonly<Record<string, unknown>>;
	/**
	 * The output directory's name, when it must differ from the spec's.
	 *
	 * **Two suites compiling one fixture to one directory with DIFFERENT options overwrite each
	 * other, and vitest runs test files in parallel.** A suite that races itself is not evidence, and
	 * the failure looks exactly like a flaky emitter.
	 */
	readonly outName?: string;
	/**
	 * The full output directory, when a suite owns one of its own rather than sharing `dir/.out/`.
	 *
	 * **Added for `vocabulary.test.ts`, which used to grade whatever `.gen.ts` files other suites
	 * had left on disk.** Nothing ordered those suites - vitest runs test files in parallel - so on a
	 * fresh checkout it graded nothing and failed, and on a second run it graded the PREVIOUS build and
	 * passed. Both measured. A suite whose input is produced by other suites has to produce its own.
	 */
	readonly outDir?: string;
}

export async function compileFixture(
	dir: string,
	name: string,
	options: FixtureOptions = {},
): Promise<CompiledFixture> {
	const outDir = options.outDir ?? join(dir, ".out", options.outName ?? name);
	/**
	 * **Emptied first, so a suite grades what THIS compile wrote.**
	 *
	 * Output accumulated across runs, and a file the emitter has stopped producing stayed on disk
	 * looking current. Measured: a control that reinstated a defect - two services overwriting one
	 * another's `schemas.gen.ts` - PASSED, because the per-service directories from the previous green
	 * run were still there for the assertions to find. A guard that reads a previous run's output is
	 * not a guard, and nothing about it looks wrong.
	 */
	rmSync(outDir, { recursive: true, force: true });
	const program = await compile(NodeHost, join(dir, `${name}.tsp`), {
		outputDir: outDir,
		emit: ["typespec-http-zod"],
		options: {
			"typespec-http-zod": {
				"emitter-output-dir": outDir,
				"contracts-output-dir": outDir,
				"contracts-package": options.contractsPackage ?? CONTRACTS_BARREL_SPECIFIER,
				"seal-object-schemas": true,
				...(options.keyVocabularies === undefined
					? {}
					: { "key-vocabularies": [...options.keyVocabularies] }),
				...(options.extraOptions ?? {}),
			},
		},
	});
	/**
	 * Written after emission, because the specifier has to be decided before it and the file only has
	 * to exist by the time anything compiles the output.
	 *
	 * Skipped when the caller named its own package: then the barrel is theirs to provide, and writing
	 * one here would quietly satisfy an import the test meant to point somewhere else.
	 */
	if (options.contractsPackage === undefined) {
		writeContractsBarrel(outDir);
	}

	return {
		outDir,
		diagnostics: program.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
		program,
	};
}
