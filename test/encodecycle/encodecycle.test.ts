import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **An `@encode` chain that returns to where it started is reported, not followed forever.** See
 * `encodecycle.tsp`.
 *
 * The schema walk, the wire-kind walk and the contract walk each followed `@encode` by calling
 * themselves on the encoded type, so `Ping -> Pong -> Ping` overflowed the stack: "Emitter
 * typespec-http-zod crashed! This is a bug." Reported as `encode-cycle` instead, once per scalar, the
 * way `inline-cycle` reports a reference cycle with nothing to name it by.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "encodecycle", { outName: "encodecycle" });
}, 300_000);

describe("two scalars whose @encode name each other", () => {
	it("is reported once per scalar on the cycle, and nothing else is reported", () => {
		expect(compiled.diagnostics).toEqual([
			{ code: "typespec-http-zod/encode-cycle", severity: "error" },
			{ code: "typespec-http-zod/encode-cycle", severity: "error" },
		]);
	});

	it("names the chain in the message", () => {
		const messages = compiled.program.diagnostics.map((d) => d.message);
		expect(messages.some((m) => m.includes("'Ping'") && m.includes("'Pong'"))).toBe(true);
	});

	it("still emits the validators, with the cycle as a value nothing satisfies", () => {
		const schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		expect(schemas).toMatch(/ping: z\.never\(\)/);
		// A scalar encoded as itself is no cycle.
		expect(schemas).toMatch(/self: z\.string\(\)/);
	});
});
