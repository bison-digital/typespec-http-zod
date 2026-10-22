import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A cycle that never passes through a declaration used to crash the emitter.**
 *
 * A recursive model is fine: it earns a declaration, and the back edge becomes a getter or a
 * `z.lazy()` naming it. A cycle closing through a type this emitter INLINES has no such name. A
 * template instantiation is the reachable case - `declaredNameOf` returns undefined for one,
 * matching how `@typespec/openapi3` inlines it - so `model Box<T> { next?: Box<T> }` used as
 * `Box<string>` walked into itself until the stack ran out. The compiler reported it as
 * `RangeError: Maximum call stack size exceeded`, under the heading "Emitter crashed! This is a
 * bug."
 *
 * The reason nothing caught it: the reference resolver returned `undefined` for any undeclared
 * candidate, which sent it straight to `typeToZodBody` and past the only place a cycle is noticed.
 *
 * **The third arm is the one that matters most.** The first cut of the guard fired on
 * `InnerModel[]`, because the array is entered before the model and is re-entered from the model's
 * own `children`. That cycle closes on `InnerModel`, which IS a declaration, and refusing it broke
 * two corpus scenarios. openapi3 asks the same question as `cycle.containsDeclaration`; this asks it
 * by counting the declarations in flight.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a reference cycle with no declaration on it", () => {
	it("is named rather than crashed", async () => {
		const compiled = await compileFixture(here, "cycle", { outName: "inline-cycle" });
		expect(compiled.diagnostics).toEqual([
			{ code: "typespec-http-zod/inline-cycle", severity: "error" },
		]);
	});

	/**
	 * The remedy the diagnostic names has to work, or it is not a remedy. `@friendlyName` makes the
	 * instantiation a declaration, which is also what openapi3 does with it: that emitter publishes a
	 * component `stringBox` and refers to it with `$ref`, where it inlines the unnamed one.
	 */
	it("compiles once @friendlyName makes the instantiation a declaration", async () => {
		const compiled = await compileFixture(here, "named", { outName: "inline-named" });
		expect(compiled.diagnostics).toEqual([]);
		const source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		// Declared under the name the document publishes, not written out inline.
		expect(source).toMatch(/export const stringBoxSchema/);
		expect(source).toMatch(/box: stringBoxSchema/);
	});

	it("leaves a cycle that DOES close on a declaration alone, through an array and a record", async () => {
		const compiled = await compileFixture(here, "declared", { outName: "inline-declared" });
		expect(compiled.diagnostics).toEqual([]);
		const source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		expect(source).toMatch(/export const innerModelSchema/);
		// The recursion resolves by naming the declaration rather than inlining it again.
		expect(source).toMatch(/innerModelSchema/);
	});
});
