import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileEmittedSet } from "./support/emitted-set.js";

/**
 * **Nothing that ships names a path that exists on one machine.**
 *
 * **The emitted output is the half that matters, and it is the half no other arm reads for this.**
 * A generated file carrying `/Users/somebody/projects/...` compiles perfectly for the person who ran
 * the emitter and for nobody else - and it would be committed by the consumer, because generated
 * output is checked in. The `runtime-module` and `contracts-package` options both take a specifier
 * that lands verbatim in the output, so an absolute one is a single mis-set option away.
 *
 * **This is a companion to "every import resolves", not a subset of it.** An absolute specifier
 * RESOLVES, on the machine that wrote it - which is exactly why a resolution check cannot see it and
 * why portability needs an assertion of its own. Both properties are real and neither implies the
 * other.
 *
 * Home directories are matched by SHAPE rather than by this machine's own path, so the guard means the
 * same thing wherever it runs; keying it on `process.env.HOME` would pass on any other machine.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** An absolute path into somebody's checkout, in the forms the three platforms spell it. */
const MACHINE_PATHS = [
	/\/Users\/[^/\s"']+\//,
	/\/home\/[^/\s"']+\//,
	/\b[A-Za-z]:\\\\?Users\\\\?/,
	/\bfile:\/\/\/[A-Za-z]/,
];

function offendersIn(label: string, text: string): string[] {
	return MACHINE_PATHS.flatMap((pattern) => {
		const match = pattern.exec(text);
		return match === null ? [] : [`${label}: ${match[0]}`];
	});
}

let emitted: string[] = [];

beforeAll(async () => {
	emitted = await compileEmittedSet("portability");
}, 900_000);

describe("nothing this package ships names one machine's filesystem", () => {
	const tracked = execFileSync("git", ["ls-files"], { cwd: packageRoot, encoding: "utf8" })
		.split("\n")
		.filter((name) => name !== "");

	it("has files to inspect at all", () => {
		expect(tracked.length).toBeGreaterThanOrEqual(20);
	});

	it("carries no machine path in any tracked file", () => {
		const offenders = tracked.flatMap((name) => {
			// This file spells every forbidden shape by definition.
			if (name === "test/portability.test.ts") return [];
			try {
				return offendersIn(name, readFileSync(`${packageRoot}/${name}`, "utf8"));
			} catch {
				return [];
			}
		});
		expect(offenders).toEqual([]);
	});

	/**
	 * **Every tracked file is ASCII, and nothing checked it until now.**
	 *
	 * The rule is standing and the sweep that applied it removed 815 em-dashes and 382 warning glyphs
	 * across 66 files. Nothing then held it: a glyph went back into a `src/registry.ts` docblock the
	 * same day, in a commit of mine, and `pnpm test` stayed green. It was found by a person reading the
	 * file rather than by this suite, which is the definition of an unguarded rule.
	 *
	 * **This is the same failure as a README claiming something is asserted while nothing asserts
	 * it**, which this package has shipped once before. A rule everyone follows is a convention; a rule
	 * something checks is a property.
	 *
	 * The report names the file, the line and the codepoint, because a bare count sends the reader
	 * hunting for an invisible character - and one of them, a zero-width space, held a block comment
	 * open past its terminator in the sibling package.
	 */
	it("carries no non-ASCII character in any tracked file", () => {
		const offenders: string[] = [];
		for (const file of tracked) {
			const contents = readFileSync(join(packageRoot, file), "utf8");
			contents.split("\n").forEach((line, index) => {
				for (const character of line) {
					const code = character.codePointAt(0) ?? 0;
					if (code > 127) {
						offenders.push(
							`${file}:${index + 1} U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
						);
						return;
					}
				}
			});
		}
		expect(offenders.toSorted()).toEqual([]);
	});

	it("carries no machine path in anything the emitter GENERATES", () => {
		/**
		 * **The arm the review asked for, and the one with a real way to fail.** Tracked files are
		 * reviewed when they change; generated files are written fresh on every compile from whatever
		 * options the consumer set, and are then committed into the consumer's repository.
		 */
		expect(emitted.length).toBeGreaterThanOrEqual(20);
		const offenders = emitted.flatMap((file) =>
			offendersIn(file.slice(packageRoot.length), readFileSync(file, "utf8")),
		);
		expect(offenders).toEqual([]);
	});
});
