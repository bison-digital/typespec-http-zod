import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Two types with one name emitted one module that does not parse, and the compile said nothing.**
 *
 * A declaration is keyed on `(visibility, name, identity)`, so `Alpha.Thing` and `Beta.Thing` are
 * two entries - and both then emit `export const thingSchema`. Measured before this arm existed:
 * the document published `Alpha.Thing` and `Beta.Thing` as separate components, the emitted module
 * declared `thingSchema` twice, `tsc` answered `TS2451: Cannot redeclare block-scoped variable` and
 * `TS2300: Duplicate identifier`, and `tsp compile` reported success.
 *
 * `duplicate-declaration` already existed and already said exactly the right thing, but only
 * `TypeRegistry` raised it - so the contracts files were covered and `schemas.gen.ts`, the module
 * every consumer imports, was not.
 *
 * Not resolved automatically, matching upstream: `@typespec/openapi3` reports the same class through
 * `checkDuplicateTypeName` and `@typespec/json-schema` through `duplicate-id`, and neither renames
 * anything, because only the author knows which name should change.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("two declarations that would bind one identifier", () => {
	it("are refused, rather than emitted into a module that cannot parse", async () => {
		const compiled = await compileFixture(here, "collide", { outName: "collide" });
		/**
		 * **Reported once, and refused by both walks** - the schema walk in `schemas.gen.ts` and the
		 * contract-type walk beside it each bind the colliding name. Counted, two reports used to be the
		 * proof that both walks refused, and they were one declaration reported twice; what proves it is
		 * the output: the module every consumer imports loads, and the set typechecks, which a walk
		 * declaring `thingSchema` twice, or pairing a refused validator with a type it did not refuse,
		 * does not.
		 */
		expect(compiled.diagnostics.map((d) => `${d.severity} ${d.code}`)).toEqual([
			"error typespec-http-zod/duplicate-declaration",
		]);
		const schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
			string,
			{ safeParse(value: unknown): { success: boolean } }
		>;
		expect(schemas.thingSchema?.safeParse({}).success).toBe(false);
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
