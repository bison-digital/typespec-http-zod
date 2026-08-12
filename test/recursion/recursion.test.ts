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
 * ⚠️ **Three ways this can look green while being broken**, all of them guarded below:
 *
 * - **It throws on import.** A `const` cannot read itself while initialising, so the reference has to
 *   be deferred behind a getter. Nothing about the emitted *text* reveals this — the failure is
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
		// If the emitted module defers nothing, THIS is where it fails — before a single assertion.
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

	it("REJECTS a wrong type at depth — proving the recursion is not `unknown`", () => {
		// The shallow case is the control: if this one passed, the arm below would prove nothing.
		expect(accepts(schemas.treeNodeSchema as ZodType, { label: 42 })).toBe(false);
		expect(
			accepts(schemas.treeNodeSchema as ZodType, {
				label: "root",
				children: [{ label: "a", children: [{ label: 42 }] }],
			}),
		).toBe(false);
	});

	it("REJECTS an undeclared key at depth — proving the seal survives the getter", () => {
		/**
		 * The one that would rot silently. `z.object({…}).strict()` throws on a recursive getter, so
		 * the emitter switches to `z.strictObject({…})`; switching to a bare `z.object` instead would
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
		// The `.loose()` → `z.looseObject` half. Paired with the strict arm above over the same input,
		// because an assertion that something is *accepted* passes on a schema that accepts everything.
		expect(accepts(schemas.openNodeSchema as ZodType, { label: "a", extra: 1 })).toBe(true);
		expect(accepts(schemas.openNodeSchema as ZodType, { label: "a", child: { label: 1 } })).toBe(
			false,
		);
	});
});

describe("a cycle with nowhere to put a getter is NAMED, not crashed", () => {
	it("reports circular-model for a loop that closes through a named union", async () => {
		/**
		 * A getter needs an object property to sit on. `Node` → `Branch` → `Node` closes through a
		 * union declaration, which has no properties, so the reference cannot be deferred. That is a
		 * real limit — but the emitter's job is to say so. Before this, the same shape was a
		 * `RangeError: Maximum call stack size exceeded` from inside the walk, which names nothing.
		 */
		const compiled = await compileFixture(here, "union-cycle");
		expect(compiled.diagnostics.map((d) => d.code)).toContain("typespec-http-zod/circular-model");
	});
});
