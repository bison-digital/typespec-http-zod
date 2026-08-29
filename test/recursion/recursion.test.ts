import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A recursive model is an ordinary construct, and the emitter has to serve it.**
 *
 * `@typespec/openapi3` publishes `model TreeNode { children?: TreeNode[] }` as a self-`$ref` and the
 * document is valid, so refusing it would be a divergence from the oracle rather than a limitation
 * anyone would accept. This file is the behavioural half of that claim: the conformance differential
 * proves the emitted *shape* matches the document, and shape agreement cannot tell you whether the
 * module even loads, let alone whether it still rejects anything.
 *
 * **Three ways this can look green while being broken**, all of them guarded below:
 *
 * - **It throws on import.** A `const` cannot read itself while initialising, so the reference has to
 *   be deferred behind a getter. Nothing about the emitted *text* reveals this - the failure is
 *   `ReferenceError: Cannot access 'treeNodeSchema' before initialization`, at import.
 * - **The getter silently un-seals the model.** Measured on Zod 4.4.3: `.strict()`, `.loose()` and
 *   `.catchall()` all read `shape` eagerly and therefore fire the getter too early, so a recursive
 *   model has to use `z.strictObject`/`z.looseObject` instead. Reach for the wrong one and the model
 *   still parses, still validates its declared fields, and quietly accepts anything else.
 * - **The recursion degrades to `unknown`.** A schema that accepts every child accepts every valid
 *   document too, so only a *rejection at depth* distinguishes the two.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

const accepts = (schema: ZodType, value: unknown): boolean => schema.safeParse(value).success;

describe("a recursive model is emitted as a reference, not refused and not inlined forever", () => {
	let schemas: Record<string, ZodType>;
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "tree");
		// If the emitted module defers nothing, THIS is where it fails - before a single assertion.
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	});

	it("compiles without an error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("emits a declaration for every recursive model, so nothing below is vacuous", () => {
		// Named explicitly rather than counted: a typo in one identifier would otherwise make its
		// arm read `undefined` and skip, and the file would still be green.
		const expected = [
			"treeNodeSchema",
			"treeIndexSchema",
			"chainSchema",
			"authorSchema",
			"bookSchema",
			"openNodeSchema",
		];
		expect(expected.filter((identifier) => schemas[identifier] === undefined)).toEqual([]);
	});

	it("accepts a tree nested several levels deep", () => {
		expect(
			accepts(schemas.treeNodeSchema as ZodType, {
				label: "root",
				children: [{ label: "a", children: [{ label: "a1" }] }, { label: "b" }],
			}),
		).toBe(true);
	});

	it("REJECTS a wrong type at depth - proving the recursion is not `unknown`", () => {
		// The shallow case is the control: if this one passed, the arm below would prove nothing.
		expect(accepts(schemas.treeNodeSchema as ZodType, { label: 42 })).toBe(false);
		expect(
			accepts(schemas.treeNodeSchema as ZodType, {
				label: "root",
				children: [{ label: "a", children: [{ label: 42 }] }],
			}),
		).toBe(false);
	});

	it("REJECTS an undeclared key at depth - proving the seal survives the getter", () => {
		/**
		 * The one that would rot silently. `z.object({...}).strict()` throws on a recursive getter, so
		 * the emitter switches to `z.strictObject({...})`; switching to a bare `z.object` instead would
		 * pass every other assertion in this file and strip unknown keys forever.
		 */
		expect(accepts(schemas.treeNodeSchema as ZodType, { label: "root", nope: true })).toBe(false);
		expect(
			accepts(schemas.treeNodeSchema as ZodType, {
				label: "root",
				children: [{ label: "a", children: [{ label: "a1", nope: true }] }],
			}),
		).toBe(false);
	});

	it("recurses through a dictionary and through a bare property", () => {
		expect(
			accepts(schemas.treeIndexSchema as ZodType, {
				label: "root",
				byName: { a: { label: "a", byName: { b: { label: "b" } } } },
			}),
		).toBe(true);
		expect(
			accepts(schemas.treeIndexSchema as ZodType, { label: "root", byName: { a: { label: 1 } } }),
		).toBe(false);
		expect(accepts(schemas.chainSchema as ZodType, { label: "a", next: { label: "b" } })).toBe(
			true,
		);
		expect(accepts(schemas.chainSchema as ZodType, { label: "a", next: { nope: 1 } })).toBe(false);
	});

	it("closes a MUTUAL cycle, which the corpus does not contain", () => {
		expect(
			accepts(schemas.authorSchema as ZodType, {
				name: "a",
				books: [{ title: "t", author: { name: "b" } }],
			}),
		).toBe(true);
		expect(
			accepts(schemas.authorSchema as ZodType, { name: "a", books: [{ title: "t", author: {} }] }),
		).toBe(false);
	});

	it("keeps a permissive recursive model permissive", () => {
		// The `.loose()` -> `z.looseObject` half. Paired with the strict arm above over the same input,
		// because an assertion that something is *accepted* passes on a schema that accepts everything.
		expect(accepts(schemas.openNodeSchema as ZodType, { label: "a", extra: 1 })).toBe(true);
		expect(accepts(schemas.openNodeSchema as ZodType, { label: "a", child: { label: 1 } })).toBe(
			false,
		);
	});
});

describe("a cycle with nowhere to put a getter is SERVED, not refused", () => {
	/**
	 * **`Node` -> `Branch` -> `Node` closes through a union declaration, which has no properties.**
	 *
	 * **This was `circular-model`, and the refusal was wrong.** A getter needs an object property
	 * to sit on and a union has none, so the reference could not be deferred - but `z.lazy()` does not
	 * need a property, and deferring the whole declaration is the place to put it. `@typespec/openapi3`
	 * publishes this spec without complaint, so refusing it made the same source representable by one
	 * emitter and not the other.
	 *
	 * **Three ways this can look green while being broken**, all guarded below:
	 *
	 * - **It throws on import**, because a `const` read itself while initialising. The arms here import
	 *   the module, so that fails before any assertion.
	 * - **It infers `any`.** `z.lazy()` alone typechecks as `any` - `TS7022` - and that is worse than
	 *   not compiling, because the wire assertions would pass while proving nothing. The emitted file is
	 *   compiled under `strict` by `emit.test.ts`; the arm here checks the annotation that makes it
	 *   sound is actually present.
	 * - **It degrades to accepting anything.** A lazy that resolves to an unconstrained schema parses
	 *   every valid document too, so only a rejection AT DEPTH tells the two apart.
	 */
	let compiled: CompiledFixture;
	let schemas: Record<string, ZodType>;

	beforeAll(async () => {
		compiled = await compileFixture(here, "union-cycle");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	}, 120_000);

	it("emits it without a diagnostic", () => {
		expect(compiled.diagnostics.map((d) => d.code)).not.toContain(
			"typespec-http-zod/circular-model",
		);
		expect(compiled.diagnostics).toEqual([]);
	});

	it("parses through the cycle, in both directions of the union", () => {
		const node = schemas["nodeSchema"];
		expect(node).toBeDefined();
		expect(node?.parse({ label: "a", branch: { label: "b" } })).toEqual({
			label: "a",
			branch: { label: "b" },
		});
		// The other variant of `Branch`, so the union has not collapsed to its model arm.
		expect(node?.parse({ label: "a", branch: "leaf" })).toEqual({ label: "a", branch: "leaf" });
	});

	it("still rejects at depth, so the cycle has not degraded to `unknown`", () => {
		const node = schemas["nodeSchema"];
		expect(node?.safeParse({ label: 1 }).success).toBe(false);
		// One level down, through the union and back into the model.
		expect(node?.safeParse({ label: "a", branch: { label: 1 } }).success).toBe(false);
		expect(node?.safeParse({ label: "a", branch: { label: "b", nope: true } }).success).toBe(false);
	});

	it("annotates the deferred declaration, which is what keeps it from inferring `any`", () => {
		/**
		 * **Asserted on the emitted TEXT, because the failure it guards is invisible at run time.**
		 * `z.lazy()` without the annotation parses identically and infers `any`, so every behavioural
		 * arm above would still pass while `wire-contract.gen.ts` silently stopped checking anything.
		 */
		const source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		/**
		 * **BOTH parameters, and naming only the first is a silent hole.** `z.ZodType<T>` means
		 * `ZodType<Output = T, Input = unknown>`, so the annotated schema reports `z.input` as
		 * `unknown` and so does every schema that references it. The wire assertion pairs `z.input`,
		 * because that is what a caller supplies - so one missing parameter took the whole cyclic
		 * corner out of the only check that catches this emitter disagreeing with itself.
		 */
		expect(source).toMatch(/export const \w+: z\.ZodType<(\w+), \1> = z\.lazy\(/);
		// Every member of the cycle carries a written-out type rather than a `z.infer` alias, or the
		// annotation closes the loop again - `TS2456`, measured.
		expect(source).not.toMatch(/export type Branch = z\.infer</);
		expect(source).not.toMatch(/export type Node = z\.infer</);
	});
});

/**
 * **A default INSIDE a cycle - the one place the two directions cannot both be named.**
 *
 * A cyclic declaration cannot take its type from `z.infer<typeof ...>`, because that is the loop, so
 * it carries a structural type written out and the deferred declaration is annotated with it. That
 * annotation fixes both of Zod's type parameters at once, and a default is the only construct this
 * emitter emits where a schema's input and output types differ. So one emitted type has to serve
 * both positions, and this fixture is what decides which way it leans.
 *
 * It leans to the INPUT shape, which is the permissive direction: every value that arrives still
 * satisfies it. Leaning the other way is the defect this release removes - a caller told to supply
 * a property the document says they may omit.
 */
describe("a default on a cycle", () => {
	let compiled: CompiledFixture;
	let schemas: Record<string, ZodType>;

	beforeAll(async () => {
		compiled = await compileFixture(here, "defaulted", { outName: "defaulted-cycle" });
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	}, 120_000);

	it("compiles with no error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("still applies the default, at the top level and through the cycle", () => {
		const node = schemas["nodeSchema"];
		expect(node?.parse({ label: "a" })).toEqual({ label: "a", depth: 0 });
		expect(node?.parse({ label: "a", branch: { label: "b" } })).toEqual({
			label: "a",
			depth: 0,
			branch: { label: "b", depth: 0 },
		});
	});

	it("names the defaulted property optional in both artefacts, at every depth", () => {
		const schemaSource = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		const requestSource = readFileSync(join(compiled.outDir, "requests.gen.ts"), "utf8");
		for (const source of [schemaSource, requestSource]) {
			expect(source).toMatch(/\n\tdepth\?: number \| undefined;/);
		}
	});
});
