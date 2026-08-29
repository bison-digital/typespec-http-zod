import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

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

	/**
	 * **The caller-side half, which the emitted TYPE used to contradict.**
	 *
	 * `requests.gen.ts` is the floor a producer supplies, and for a request the producer is the
	 * CALLER. The document publishes every property here as optional - openapi3 builds `required`
	 * from `metadataInfo.isOptional`, which these `?`s satisfy - and the emitted type said they were
	 * required, because it was shaped to match `z.infer`, the OUTPUT type, where the default has
	 * already fired. So a gateway, an MCP worker or a React app had to supply a value the spec says
	 * it does not need.
	 *
	 * Reported by a consumer carrying a named `Sends<>` helper to relax six such properties.
	 */
	it("emits a defaulted OPTIONAL property as optional, which is what the document says", () => {
		const source = readFileSync(join(compiled.outDir, "requests.gen.ts"), "utf8");
		const row = /interface Row \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
		expect(row, "no Row interface found").not.toBe("");
		for (const name of ["tags", "inner", "nested", "empty", "count"]) {
			expect(row, `${name} should be optional`).toMatch(
				new RegExp(`\\n\\t${name}\\?: [^\\n]* \\| undefined;`),
			);
		}
	});

	/**
	 * **The question no text arm can answer: can a caller build one?**
	 *
	 * Deliberately assigns a plain object literal with none of the defaulted properties, and a
	 * SECOND one supplying an optional argument by spread - which under `exactOptionalPropertyTypes`
	 * produces `{ count?: number | undefined }` and is why the emitted type says `| undefined`
	 * explicitly rather than being wrapped in `Partial<>`.
	 */
	it("lets a caller build a request supplying none of the defaulted properties", () => {
		const file = join(compiled.outDir, "consumer.ts");
		writeFileSync(
			file,
			`
import type { WireInputs, Row } from "./requests.gen.js";

export const minimal: Row = {};

export function build(count?: number): WireInputs["addRow"] {
	return { ...(count === undefined ? {} : { count }) };
}
`,
		);
		try {
			const { output, failed } = typecheckEmitted(compiled.outDir);
			expect(output.trim(), output).toBe("");
			expect(failed).toBe(false);
		} finally {
			rmSync(file, { force: true });
		}
	});
});

/**
 * **A default on a REQUIRED property, which is a different construct and was treated as the same
 * one.**
 *
 * See `required.tsp` for the derivation. In short: JSON Schema 2020-12 makes `default` an
 * annotation, `@typespec/openapi3` never consults it when building `required`, and
 * OAI/OpenAPI-Specification#1543 is closed on the point that writing a default in before validating
 * is not validation. So the document says the property is required, and this emitter's
 * `.default(...)` said the caller could omit it - the validator accepting a request the document
 * beside it forbids.
 *
 * **Nothing graded this.** Measured across every compiled document on disk in all three repos:
 * zero component schemas carried a property-level `default`, so the differential comparing
 * validators against documents had never once seen one.
 */
describe("a default on a required property is an annotation, not an optionality", () => {
	let schemas: Record<string, ZodType>;
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "required");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	}, 120_000);

	it("compiles, because the spec is representable and openapi3 emits it", () => {
		/**
		 * **A warning, not a refusal, and the distinction is one this package has already learned.**
		 * `unsupported-default` used to be an error and was removed because refusing a construct
		 * openapi3 emits makes the same spec representable by one emitter and not the other - "the one
		 * thing a differential between the two cannot tolerate", in `zod.ts`'s own words. This spec is
		 * representable. What is wrong with it is that the annotation is dead: a required property is
		 * never absent, so the default can never apply. That is worth saying and not worth refusing.
		 */
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(Object.keys(schemas).length).toBeGreaterThanOrEqual(2);
	});

	it("names every required defaulted property, and only those", () => {
		const named = compiled.program.diagnostics
			.filter((d) => d.code === "typespec-http-zod/default-on-required-property")
			.map((d) => d.message);
		expect(named).toHaveLength(3);
		expect(named.join("\n")).toContain("basis");
		expect(named.join("\n")).toContain("kind");
		expect(named.join("\n")).toContain("size");
		// The controls beside them: both are optional, so the document permits their absence.
		expect(named.join("\n")).not.toContain("note");
		expect(named.join("\n")).not.toContain("cursor");
		expect(named.every((message) => message.includes("?"))).toBe(true);
	});

	it("requires a document-required property, whatever default it carries", () => {
		const outer = schemas["outerSchema"];
		expect(outer).toBeDefined();
		// `kind` and `inner.basis` are both required in the document, so neither may be omitted.
		expect(outer?.safeParse({ id: "i", inner: { basis: "b" } }).success).toBe(false);
		expect(outer?.safeParse({ id: "i", kind: "k", inner: {} }).success).toBe(false);
		expect(outer?.safeParse({ id: "i", kind: "k", inner: { basis: "b" } }).success).toBe(true);
	});

	it("still applies the default of the OPTIONAL property beside it", () => {
		const inner = schemas["innerSchema"];
		expect(inner?.parse({ basis: "b" })).toEqual({ basis: "b", note: "none" });
	});

	it("emits no `.default(` for a required property, so nothing fills it in", () => {
		const source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		/**
		 * Non-vacuity: the OPTIONAL default in the same file is still emitted, so this is not passing
		 * because the emitter stopped writing defaults altogether.
		 */
		expect(source).toContain('.default("none")');
		expect(source).not.toContain('.default("s1159")');
		expect(source).not.toContain('.default("standard")');
		expect(source).not.toContain(".default(25)");
	});

	it("keeps the required property required in the emitted type too", () => {
		const source = readFileSync(join(compiled.outDir, "requests.gen.ts"), "utf8");
		expect(source).toMatch(/\n\tbasis: string;/);
		expect(source).toMatch(/\n\tkind: string;/);
		expect(source).toMatch(/\n\tnote\?: string \| undefined;/);
	});

	/**
	 * **A default ONE LEVEL DOWN, which is the case a top-level helper cannot reach.**
	 *
	 * The consumer who reported this carried a `Sends<Op, Defaulted>` helper naming six properties by
	 * hand, and said so in its docblock: it relaxes the TOP level only. `outer.inner.note` stays
	 * required through such a helper, and no caller can build the value at all. Emitting the
	 * optionality on the property itself has no depth to reach, which is the whole argument for
	 * putting it there rather than in a helper.
	 *
	 * Written with no spread and no cast at any level, for the reason `contractshape/` records: a
	 * spread is the documented workaround for exactly this, so an arm that needs one proves the
	 * opposite of what it claims.
	 */
	it("lets a caller build a nested value omitting a defaulted property one level down", () => {
		const file = join(compiled.outDir, "consumer.ts");
		writeFileSync(
			file,
			`
import type { WireInputs, Inner } from "./requests.gen.js";

const inner: Inner = { basis: "b" };

export const request: WireInputs["create"] = { kind: "k", id: "i", inner };

/** The handler's side of the same shape: what it was GIVEN is still assignable to the floor. */
export function echo(received: { kind: string; id: string; inner: { basis: string; note: string } }): WireInputs["create"] {
	return received;
}
`,
		);
		try {
			const { output, failed } = typecheckEmitted(compiled.outDir);
			expect(output.trim(), output).toBe("");
			expect(failed).toBe(false);
		} finally {
			rmSync(file, { force: true });
		}
	});
});
