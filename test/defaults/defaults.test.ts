import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A composite default is an ordinary construct, and this emitter refused it.**
 *
 * **The refusal was a statement about the emitter, not about what can be represented.**
 * `unsupported-default` fired on `#["a", "b"]` and `#{ x: 1 }`, with the recorded reason that "a
 * populated literal default would need each element rendered, and no schema here has one". Meanwhile
 * `.default()` takes any JS value, and `@typespec/openapi3` publishes all of them - measured from one
 * compile of this fixture: `default: ["a","b"]`, `default: {"x":1,"label":"hi"}`,
 * `default: [["p"],["q"]]`. So the document could say it and the validator could enforce it, and only
 * this emitter said no.
 *
 * **The refusal path also emitted `.default(z.never())`.** `UNREPRESENTABLE` is a schema
 * expression and this position takes a VALUE, so the output named a Zod object as the fallback for
 * the property. It never ran because the diagnostic was an error and the compile stopped - but the
 * moment that severity changed, it would have compiled and been wrong at run time.
 *
 * Two ways this can look green while being broken, both guarded below:
 *
 * - **The default is emitted but never applied.** A shape comparison sees `.default(...)` and is
 *   satisfied; only parsing an absent property tells you what the caller actually receives.
 * - **The default is applied but the constraint is gone.** A property that accepts anything also
 *   accepts every valid document, so only a rejection distinguishes the two.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a composite default is rendered, not refused", () => {
	let schemas: Record<string, ZodType>;
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "composite");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	}, 120_000);

	it("compiles the fixture without a diagnostic", () => {
		// Non-vacuity: every arm below reads the emitted module, which a failed compile would not have.
		expect(compiled.diagnostics).toEqual([]);
		expect(Object.keys(schemas).length).toBeGreaterThanOrEqual(2);
	});

	it("applies every declared default when the property is absent", () => {
		const row = schemas["rowSchema"];
		expect(row).toBeDefined();
		expect(row?.parse({})).toEqual({
			tags: ["a", "b"],
			inner: { x: 1, label: "hi" },
			nested: [["p"], ["q"]],
			empty: [],
			count: 3,
		});
	});

	it("still validates the property when the caller supplies one", () => {
		const row = schemas["rowSchema"];
		expect(row?.parse({ tags: ["z"] })).toMatchObject({ tags: ["z"] });
		/**
		 * **The half a default can silently destroy.** A property rendered as `z.unknown().default(...)`
		 * would satisfy the arm above and accept this too.
		 */
		expect(row?.safeParse({ inner: { x: "not a number", label: "L" } }).success).toBe(false);
		expect(row?.safeParse({ tags: [1, 2] }).success).toBe(false);
		expect(row?.safeParse({ nested: ["flat"] }).success).toBe(false);
	});

	it("emits a value, never a schema expression, in the default position", () => {
		/**
		 * **`.default(z.never())` is what the refusal path emitted**, and it is invisible to a parse
		 * test while the diagnostic remains an error, because the compile never completes. Asserted as a
		 * CLASS over the emitted text so any schema expression reaching this position fails, rather than
		 * the one spelling that happened to occur.
		 */
		const source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		expect(source).toContain(".default(");
		expect(source).not.toMatch(/\.default\(\s*z\./);
	});
});
