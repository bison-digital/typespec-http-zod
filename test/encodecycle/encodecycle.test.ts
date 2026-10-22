import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **An `@encode` chain that returns to where it started is refused, not followed forever.** See
 * `encodecycle.tsp`.
 *
 * The schema walk, the wire-kind walk and the contract walk each followed `@encode` by calling
 * themselves on the encoded type, so `Ping -> Pong -> Ping` overflowed the stack: "Emitter
 * typespec-http-zod crashed! This is a bug." A scalar encoded as a scalar that is not standard is
 * published with no type, so each walk stops at the first link and the schema walk reports
 * `unsatisfiable-encoding`, once per scalar. `Self`, encoded as itself, is no cycle and is refused
 * for the same reason: openapi3 publishes it as `{ format: "y" }`, which states no type.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "encodecycle", { outName: "encodecycle" });
}, 300_000);

describe("scalars encoded as scalars that are not standard", () => {
	it("is reported once per scalar, and nothing else is reported", () => {
		expect(compiled.diagnostics).toEqual([
			{ code: "typespec-http-zod/unsatisfiable-encoding", severity: "error" },
			{ code: "typespec-http-zod/unsatisfiable-encoding", severity: "error" },
			{ code: "typespec-http-zod/unsatisfiable-encoding", severity: "error" },
		]);
	});

	it("names the scalar and its encoding in the message", () => {
		const messages = compiled.program.diagnostics.map((d) => d.message);
		expect(messages.some((m) => m.includes("'Ping'") && m.includes("'Pong'"))).toBe(true);
		expect(messages.some((m) => m.startsWith("'Self'"))).toBe(true);
	});

	it("still emits the validators, each a value nothing satisfies", () => {
		const schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		expect(schemas).toMatch(/ping: z\.never\(\)/);
		expect(schemas).toMatch(/self: z\.never\(\)/);
	});
});
