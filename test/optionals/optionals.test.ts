import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/** See `optionals.tsp`. The oracle is a COMPILE under `exactOptionalPropertyTypes`. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "optionals", { outName: "optionals" });
}, 300_000);

/** Compile a consumer against the emitted schemas, returning everything `tsc` said. */
function consumer(body: string): string {
	const file = join(compiled.outDir, "consumer.probe.ts");
	writeFileSync(file, body);
	const config = join(compiled.outDir, "tsconfig.optionals.json");
	writeFileSync(
		config,
		JSON.stringify({
			compilerOptions: {
				target: "es2023",
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				exactOptionalPropertyTypes: true,
				noEmit: true,
				skipLibCheck: true,
			},
			include: ["./consumer.probe.ts"],
		}),
	);
	try {
		execFileSync(join(here, "..", "..", "node_modules", ".bin", "tsc"), [
			"-p",
			config,
			"--ignoreConfig",
		]);
		return "";
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
	}
}

describe("an optional property under exactOptionalPropertyTypes", () => {
	it("accepts the property being absent", () => {
		const output = consumer(
			'import type { Thing } from "./schemas.gen.js";\nexport const a: Thing = { id: "x" };\n',
		);
		expect(output, output).toBe("");
	});

	it("accepts the property being present with a value", () => {
		const output = consumer(
			'import type { Thing } from "./schemas.gen.js";\nexport const a: Thing = { id: "x", note: "n" };\n',
		);
		expect(output, output).toBe("");
	});

	it("REFUSES the property being explicitly undefined, which no JSON body can carry", () => {
		const output = consumer(
			'import type { Thing } from "./schemas.gen.js";\nexport const a: Thing = { id: "x", note: undefined };\n',
		);
		expect(output, "an explicit undefined was accepted").not.toBe("");
	});
});
