import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "./support/compile-fixture.js";
import { typecheckEmitted } from "./support/typecheck-emitted.js";

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
let specialWords: CompiledFixture;

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
	/**
	 * Reserved words as model names, and a discriminated union with the default envelope. Both emitted
	 * TypeScript that does not parse, and neither was visible to any arm that reads emitted output
	 * without compiling it.
	 */
	specialWords = await compileFixture(referenceDir, "specialwords", { outName: "special-emit" });
});

describe("the emitted output compiles", () => {
	it("passes tsc under the settings a consumer builds with", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		// The output is the evidence - a bare `toBe(false)` would report "expected true to be false".
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});

	it("compiles a reserved-word model name and an envelope union", () => {
		const { output, failed } = typecheckEmitted(specialWords.outDir);
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
