import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * The corpus scenario that exists to carry reserved words, addressed by PATH.
 *
 * Deliberately not `discoverScenarios().find((s) => s.name === ...)`: `provenance.test.ts` refuses
 * behaviour keyed on a name a spec author chose, and that rule is right. A path to a vendored file
 * is this package saying where it reads from; `.name === "..."` would be it deciding that one word
 * means something.
 */
const CORPUS_WORDS_SPEC = join(
	here,
	"..",
	"node_modules",
	"@typespec",
	"http-specs",
	"specs",
	"special-words",
	"main.tsp",
);
const CORPUS_WORD_SPEC = "corpus-words";

/**
 * Every model name the corpus's reserved-word scenario declares, as a spec of our own.
 *
 * **The words are read, never listed.** A corpus bump that adds a word adds it here, and the arm
 * that compiles the result is what says whether the reserved set already knew about it.
 */
function generateCorpusWordSpec(): string {
	const source = readFileSync(CORPUS_WORDS_SPEC, "utf8");
	const words = [
		...new Set(
			[...source.matchAll(/^\s*model\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s/gm)].map((m) => m[1] ?? ""),
		),
	].toSorted();
	// Non-vacuity: a regex that stopped matching would generate an empty spec that compiles happily.
	if (words.length < 30) {
		throw new Error(`read only ${words.length} model names from the corpus word scenario`);
	}
	const dir = join(referenceDir, ".out-generated");
	mkdirSync(dir, { recursive: true });
	const body = words
		.map(
			(word) =>
				`model \`${word}\` {\n  value: string;\n}\n\n@route("/${word}")\n@post\nop takes${word}(@body body: \`${word}\`): Holder;\n`,
		)
		.join("\n");
	writeFileSync(
		join(dir, `${CORPUS_WORD_SPEC}.tsp`),
		`import "@typespec/http";\n\nusing Http;\n\n// GENERATED from @typespec/http-specs. Do not edit; edit nothing and re-run.\n@service(#{ title: "corpus words" })\nnamespace CorpusWords;\n\nmodel Holder {\n  ok: boolean;\n}\n\n${body}`,
	);
	return dir;
}

let compiled: CompiledFixture;
let cyclic: CompiledFixture;
let dollars: CompiledFixture;
let specialWords: CompiledFixture;
let corpusSpecialWords: CompiledFixture;

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
	/**
	 * **A model per word, from a word list this package does not own and cannot edit.**
	 *
	 * The spec is GENERATED from `@typespec/http-specs`, read off disk, rather than written here:
	 * a fixture somebody here types out declares the words they thought of, which is how a reserved
	 * set comes to be graded against itself.
	 */
	corpusSpecialWords = await compileFixture(generateCorpusWordSpec(), CORPUS_WORD_SPEC, {
		outDir: join(referenceDir, ".out", "corpus-special-emit"),
	});
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

	/**
	 * **The arm that can catch a word the reserved set has MISSED, which the fixture above cannot.**
	 *
	 * `specialwords.tsp` declares `await`, `break` and `for`. All three are in
	 * `RESERVED_DECLARATION_NAMES`, so it grades the list against itself: a fixture built from the
	 * same set the code consults passes for every word the set already knows and is silent about
	 * every word it does not. `as` lived in exactly that gap and reached a published version --
	 * contextual, so the reasoning that correctly keeps `yield` and `string` out kept `as` out too,
	 * and `export type as = ...` does not parse.
	 *
	 * This compiles a word list this package did not write and cannot edit. Proven red by deleting
	 * one word from the reserved set: `TS1005`, naming the line.
	 */
	it("compiles every special word the CORPUS declares, not the ones this package chose", () => {
		const { output, failed } = typecheckEmitted(corpusSpecialWords.outDir);
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
