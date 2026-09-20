import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

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
		 * Both registries see the collision - the schema walk and the contract-type walk - and each
		 * names it once. Asserted as "every diagnostic is this one" rather than as a count, so an
		 * unrelated refusal creeping into the fixture fails here rather than hiding behind it.
		 */
		/**
		 * **Two, and the count is the point.** Both walks bind the colliding name - the schema walk in
		 * `schemas.gen.ts` and the contract-type walk beside it - so both have to refuse it. Asserting
		 * "at least one" passed with the schema-side check deleted, because the contract-side one went
		 * on firing and the module every consumer imports was still emitted with `thingSchema`
		 * declared twice.
		 */
		expect(compiled.diagnostics.length).toBeGreaterThanOrEqual(2);
		expect(
			compiled.diagnostics.filter(
				(d) => d.code !== "typespec-http-zod/duplicate-declaration" || d.severity !== "error",
			),
		).toEqual([]);
	});
});
