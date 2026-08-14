import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "./support/compile-fixture.js";

/**
 * **The emitted TypeScript has to compile, and nothing else here proves it.**
 *
 * **"It compiled" is not evidence that output is correct - but "it did not compile" is proof it is
 * wrong, and that has happened for reasons no assertion about content would have caught:** an
 * unquoted object key (`x-ms-test-header`) that made the file unparseable; two operations in
 * different interfaces sharing a name, so the same `const` was declared twice; a recursive model
 * emitted with a strictness suffix that reads `shape` eagerly and throws during module
 * initialisation.
 *
 * So this suite runs the real compiler over the real output, the way a consumer's build does. It is
 * deliberately NOT a golden-file suite: asserting the emitted text byte-for-byte would fail on every
 * whitespace change and prove nothing about whether the result works.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const referenceDir = join(here, "reference");

let compiled: CompiledFixture;
let cyclic: CompiledFixture;
let dollars: CompiledFixture;

beforeAll(async () => {
	// Its own output directory. This and `reference.test.ts` both compiled `service` into
	// `reference/.out/service/`, in parallel, and the loser's options decided what the winner
	// graded - measured as TS2305s against a `schemas.gen.ts` written under different options.
	compiled = await compileFixture(referenceDir, "service", { outName: "service-emit" });
	/**
	 * **A cycle emits a SHAPE OF OUTPUT nothing else here compiles**, and it is the shape most
	 * likely to typecheck wrongly rather than not at all. A declaration on a cycle carries a written-out
	 * type and a `z.ZodType<T>` annotation; drop the annotation and the module still loads, still parses,
	 * still rejects - and infers `any`, at which point `wire-contract.gen.ts` asserts nothing. Measured:
	 * `TS7022` on the deferred declaration AND on the sibling it poisons.
	 *
	 * This arm existed for one fixture, so that whole class was uncompiled.
	 */
	cyclic = await compileFixture(join(here, "recursion"), "union-cycle", { outName: "cycle-emit" });
	/**
	 * Identifiers carrying a `$`. Whether an emitted file imports a name is decided by asking whether
	 * the rendered text mentions it, and asking that with a pattern built from the name reports every
	 * such identifier absent - so the import is dropped and the module references an undeclared name.
	 * That is invisible to every arm except a compiler, and it went live in the sibling package.
	 */
	dollars = await compileFixture(referenceDir, "identifiers", { outName: "identifiers-emit" });
});

/** Run `tsc` over one emitted directory, under the settings a consumer builds with. */
function typecheckEmitted(outDir: string): { output: string; failed: boolean } {
	/**
	 * A tsconfig written beside the output, so the compiler sees exactly the generated files and
	 * nothing of this package's own source. `strict` and `exactOptionalPropertyTypes` because an
	 * emitter whose output only compiles under lenient settings has pushed its problem downstream.
	 */
	const config = join(outDir, "tsconfig.emitted.json");
	writeFileSync(
		config,
		JSON.stringify(
			{
				compilerOptions: {
					target: "es2023",
					module: "nodenext",
					moduleResolution: "nodenext",
					strict: true,
					exactOptionalPropertyTypes: true,
					noUncheckedIndexedAccess: true,
					noEmit: true,
					skipLibCheck: true,
					types: [],
				},
				include: ["./*.ts"],
			},
			null,
			"\t",
		),
	);

	let output = "";
	let failed = false;
	try {
		output = execFileSync(
			join(here, "..", "node_modules", ".bin", "tsc"),
			["-p", config, "--ignoreConfig"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
	} catch (error) {
		failed = true;
		const asExec = error as { stdout?: string; stderr?: string };
		output = `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`;
	}
	return { output, failed };
}

describe("the emitted output compiles", () => {
	it("passes tsc under the settings a consumer builds with", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		// The output is the evidence - a bare `toBe(false)` would report "expected true to be false".
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});

	it("compiles identifiers carrying a `$`, whose imports a pattern would drop", () => {
		const { output, failed } = typecheckEmitted(dollars.outDir);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});

	it("compiles a CYCLE without inferring `any`", () => {
		/**
		 * **`noImplicitAny` is what makes this arm bite, and `strict` already implies it.** The
		 * failure is not a missing declaration - the module loads and behaves correctly either way. It is
		 * `TS7022`, "implicitly has type 'any' because it is referenced directly or indirectly in its own
		 * initializer", which is the compiler refusing to pretend it resolved a type it did not.
		 */
		const { output, failed } = typecheckEmitted(cyclic.outDir);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});
});
