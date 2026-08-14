import { rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";

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
}

export interface FixtureOptions {
	/**
	 * Where the emitted files import their runtime contract from.
	 *
	 * **A fixture cannot use the default.** `typespec-http-zod/runtime` is correct for a consumer
	 * and unresolvable from this package's own `.out/`, so a suite that left it alone would emit files
	 * it cannot load - and would be measuring nothing while looking green.
	 */
	readonly runtimeModule?: string;
	/**
	 * Where the emitted Zod and wire assertions import their shared types from. The default points at
	 * the vocabularies module alone, which is enough for a suite that only loads the schemas - but
	 * `wire-contract.gen.ts` names request types too, so under the default it references members that
	 * module does not export and **cannot compile**. A suite that compiles the whole emitted set has
	 * to supply a barrel over both, the way a real consumer's contracts package is one.
	 */
	readonly contractsPackage?: string;
	readonly keyVocabularies?: readonly string[];
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

/**
 * The name of the barrel this harness writes beside the emitted output.
 *
 * **A suite that compiles the WHOLE emitted set needs one, and pointing `contracts-package` at
 * `vocabularies.gen.js` instead is a trap that looks fine until it is compiled.**
 * `wire-contract.gen.ts` names request types as well as vocabularies, so under that setting it
 * references members the module does not export - four `TS2694`s and, downstream of them, four
 * identity assertions failing for a reason that has nothing to do with the shapes.
 *
 * A real consumer's contracts package is a barrel over both. So is this.
 */
const CONTRACTS_BARREL = "contracts.barrel";

/**
 * This package's own `src/runtime.ts`, as a specifier the emitted file can actually resolve.
 *
 * **Relative, and spelled `.js`, and both matter.** An absolute path bakes one machine's checkout
 * into generated output; a `.ts` extension is rejected under `nodenext` without
 * `allowImportingTsExtensions`. Writing `./x.js` for a neighbouring `x.ts` is TypeScript's own
 * convention under node resolution, and it is what a real consumer's build sees.
 */
function runtimeFixtureModule(outDir: string): string {
	const runtime = fileURLToPath(new URL("../../src/runtime.ts", import.meta.url));
	const specifier = relative(outDir, runtime).replaceAll("\\", "/").replace(/\.ts$/, ".js");
	return specifier.startsWith(".") ? specifier : `./${specifier}`;
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
				"contracts-package": options.contractsPackage ?? `./${CONTRACTS_BARREL}.js`,
				"seal-object-schemas": true,
				"runtime-module": options.runtimeModule ?? runtimeFixtureModule(outDir),
				...(options.keyVocabularies === undefined
					? {}
					: { "key-vocabularies": [...options.keyVocabularies] }),
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
		writeFileSync(
			join(outDir, `${CONTRACTS_BARREL}.ts`),
			[
				"// The contracts package, as a consumer's would be: one specifier over both artefacts.",
				'export * from "./requests.gen.js";',
				'export * from "./vocabularies.gen.js";',
				"",
			].join("\n"),
		);
	}

	return {
		outDir,
		diagnostics: program.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
	};
}
