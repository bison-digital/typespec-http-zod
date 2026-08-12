import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "./support/compile-fixture.js";

/**
 * **The emitted TypeScript has to compile, and nothing else here proves it.**
 *
 * ⚠️ **"It compiled" is not evidence that output is correct — but "it did not compile" is proof it is
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

beforeAll(async () => {
	compiled = await compileFixture(referenceDir, "service");
});

describe("the emitted output compiles", () => {
	it("passes tsc under the settings a consumer builds with", () => {
		/**
		 * A tsconfig written beside the output, so the compiler sees exactly the four generated files
		 * and nothing of this package's own source. `strict` and `exactOptionalPropertyTypes` because an
		 * emitter whose output only compiles under lenient settings has pushed its problem downstream.
		 */
		const config = join(compiled.outDir, "tsconfig.emitted.json");
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
		// The output is the evidence — a bare `toBe(false)` would report "expected true to be false".
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});
});
