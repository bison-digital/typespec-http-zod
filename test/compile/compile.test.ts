/**
 * **`compile-schemas` changes how fast a validator runs and nothing else.**
 *
 * `z.compile()` walks a schema once and emits a flat function through `new Function`, falling back to
 * the ordinary parser for anything it cannot handle. That makes it a pure performance switch - and a
 * pure performance switch is exactly the kind of change that is easy to ship broken, because the
 * output still compiles and every existing arm still passes.
 *
 * So the two builds are compared against each other: same spec, same fixtures, one option apart. The
 * emitted text must differ (or the option did nothing) and every verdict and every parsed value must
 * match (or it did too much).
 *
 * The cycle is the reason this fixture exists. `z.lazy()` is the one construct Zod lists as
 * uncompilable, the emitted form names the const being defined from inside its own body, and this
 * repository has already shipped a break of that exact shape - `.strict()` reads `shape` eagerly and
 * throws `Cannot access 'X' before initialization` during module initialisation. Loading the module
 * at all is therefore part of the assertion.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

const here = fileURLToPath(new URL(".", import.meta.url));

let plainSource = "";
let compiledSource = "";
let plain: Record<string, unknown> = {};
let compiled: Record<string, unknown> = {};
let compiledDir = "";

beforeAll(async () => {
	const a = await compileFixture(here, "compile", { outName: "compile-plain" });
	const b = await compileFixture(here, "compile", {
		outName: "compile-on",
		extraOptions: { "compile-schemas": true },
	});
	compiledDir = b.outDir;
	const read = (dir: string): string => readFileSync(join(dir, "schemas.gen.ts"), "utf8");
	plainSource = read(a.outDir);
	compiledSource = read(b.outDir);
	plain = (await import(join(a.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
	compiled = (await import(join(b.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
}, 600_000);

/** Conformant, non-conformant, and one of each edge the fixture was built to reach. */
const VALUES: readonly unknown[] = [
	{ label: "a", attributes: {} },
	{ label: "a", attributes: { k: "v" }, note: "n" },
	{ label: "a", attributes: {}, children: [{ label: "b", attributes: {} }] },
	{ label: "", attributes: {} },
	{ label: "a" },
	{ label: "a", attributes: { k: 1 } },
	{ label: "a", attributes: {}, note: undefined },
	{ label: "a", attributes: {}, children: [{ label: "", attributes: {} }] },
	undefined,
	{},
];

describe("compile-schemas", () => {
	it("is OFF by default, so the option is the only thing that turns it on", () => {
		expect(plainSource).not.toContain("z.compile(");
		expect(compiledSource).toContain("z.compile(");
	});

	it("wraps the ordinary validators and the parameter groups", () => {
		const wrapped = [
			...compiledSource.matchAll(/export const (\w+)(?::[^=]+)? = z\.compile\(/g),
		].map((match) => match[1]);
		// Named rather than counted: an implementation that wrapped only the model would pass a floor.
		expect(wrapped).toContain("nodeSchema");
		expect(wrapped).toContain("createQuery");
	});

	/**
	 * **A DEFERRED declaration is left alone, and the reason is a measurement.**
	 *
	 * `branchSchema` closes a cycle through a named union, so it emits `z.lazy()` and its body
	 * forward-references `nodeSchema`, declared further down the module. Wrapping it produced output
	 * that imported cleanly and then threw `Cannot read properties of undefined (reading '_zod')` on
	 * the FIRST PARSE - a failure that reaches a running server rather than a build. `z.lazy()` is on
	 * Zod's own list of uncompilable constructs, so nothing is lost by skipping it.
	 */
	it("leaves a deferred declaration uncompiled, because compiling one breaks at request time", () => {
		expect(compiledSource).toMatch(/export const branchSchema[^=]*= z\.lazy\(/);
		expect(compiledSource).not.toMatch(/export const branchSchema[^=]*= z\.compile\(/);
	});

	it("loads at all, which for a cycle is most of the assertion", () => {
		expect(compiled["nodeSchema"]).toBeDefined();
	});

	it("answers every value exactly as the uncompiled build does", () => {
		const a = plain["nodeSchema"] as ZodType;
		const b = compiled["nodeSchema"] as ZodType;
		for (const value of VALUES) {
			const one = a.safeParse(value);
			const two = b.safeParse(value);
			expect(two.success, `verdict differs for ${JSON.stringify(value)}`).toBe(one.success);
			expect(JSON.stringify(two.data), `output differs for ${JSON.stringify(value)}`).toBe(
				JSON.stringify(one.data),
			);
		}
	});

	it("still rejects something, so the arm above is not comparing two schemas that accept anything", () => {
		const b = compiled["nodeSchema"] as ZodType;
		expect(b.safeParse({ label: "a", attributes: {} }).success).toBe(true);
		expect(b.safeParse({ label: "", attributes: {} }).success).toBe(false);
	});

	it("emits output that compiles under the settings a consumer builds with", () => {
		const { output, failed } = typecheckEmitted(compiledDir);
		expect(output, output).toBe("");
		expect(failed).toBe(false);
	});
});
