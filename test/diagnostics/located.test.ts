import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { $lib } from "../../src/index.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **`Record<never>` states closedness, and refusing it was a defect rather than a limit.**
 *
 * `@typespec/openapi3` publishes `model A { ...Record<never>; name: string }` as
 * `additionalProperties: {not: {}}` with no diagnostic, so the same source has to be representable
 * here or the two emitters disagree about what a spec may say. This emitter read the indexer as an
 * ordinary typed catchall, reached the `never` intrinsic through it, and refused the whole compile.
 *
 * It reached a consumer as 32 byte-identical errors against a 3,755-line spec, every one reading
 * `<unknown location>:1:1` because an intrinsic has no source node to point at. So there were two
 * faults on top of each other: a refusal that should not happen, and a message that could not be
 * acted on when it did.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a closed model is emitted, not refused", () => {
	let compiled: CompiledFixture;
	let schemas: Record<string, ZodType>;

	beforeAll(async () => {
		compiled = await compileFixture(here, "located");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	}, 120_000);

	it("compiles without a diagnostic", () => {
		expect(compiled.diagnostics).toEqual([]);
		// Non-vacuity: the arms below read the emitted module, which a failed compile would not produce.
		expect(Object.keys(schemas).length).toBeGreaterThanOrEqual(3);
	});

	it("seals a model closed with `Record<never>`, rather than walking the `never`", () => {
		for (const name of ["closedFirstSchema", "closedLastSchema"]) {
			const schema = schemas[name];
			expect(schema, name).toBeDefined();
			// Sealed is the whole point: an undeclared property is refused, not stripped.
			const declared = name === "closedFirstSchema" ? { name: "a" } : { other: "a" };
			expect(schema?.safeParse(declared).success, name).toBe(true);
			expect(schema?.safeParse({ ...declared, surplus: 1 }).success, name).toBe(false);
		}
	});

	it("drops a `never` variant from a union rather than refusing it", () => {
		const schema = schemas["unionWithNeverSchema"];
		expect(schema?.safeParse({ value: "text" }).success).toBe(true);
		expect(schema?.safeParse({ value: 5 }).success).toBe(false);
	});
});

describe("a refusal a spec author can act on", () => {
	/**
	 * A diagnostic that says what is wrong but not what to do is half a diagnostic. Every other
	 * refusal this package raises names a remedy; `unsupported-type` did not, and it is the one a
	 * consumer met 32 times.
	 *
	 * Asserted as a CLASS over the declared diagnostics rather than over the one that was reported.
	 */
	it("names a remedy in every diagnostic it declares", () => {
		const declared = Object.entries($lib.diagnostics);
		expect(declared.length).toBeGreaterThanOrEqual(6);

		const silent: string[] = [];
		for (const [code, definition] of declared) {
			/**
			 * Rendered rather than read as source: these are `paramMessage` closures, and stringifying
			 * one gives the function rather than the text. A proxy standing in for every parameter
			 * renders the fixed parts, which is where a remedy has to live to be unconditional.
			 */
			const render = (definition as { messages: { default: (args: unknown) => string } }).messages
				.default;
			const message = render(new Proxy({}, { get: (_target, key) => String(key) }));
			/**
			 * A remedy is an instruction to the reader. Every message here phrases one as an imperative,
			 * so the presence of one is checkable without pinning the wording.
			 */
			if (
				!/\b(Give|Replace|Remove|Declare|Cover|Check|Route|Use|Set|Add|Encode|Break)\b/.test(
					message,
				)
			) {
				silent.push(code);
			}
		}
		expect(silent.toSorted()).toEqual([]);
	});
});
