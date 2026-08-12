import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **Question 1 of three: does the Zod half stand alone?**
 *
 * The reference service belongs to no application and models no real domain. Every construct in it is
 * one that has broken an emitter, and each is annotated in `service.tsp` with the failure it exists to
 * catch. This suite asks the narrowest useful thing of it: that the emitter runs, refuses nothing it
 * should not, and declares a validator for every operation the document publishes.
 *
 * The keyword-for-keyword agreement with `@typespec/openapi3` is the differential's job, not this
 * file's. This one exists so that a break in the emitter's basic operation fails somewhere small and
 * legible rather than inside the differential's shape comparison.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("the reference service emits", () => {
	it("compiles with no diagnostic of any severity", async () => {
		const compiled = await compileFixture(here, "service");
		// Named, not counted: a refusal here is a claim about the reference spec and has to be read.
		expect(compiled.diagnostics.map((d) => `${d.severity}: ${d.code}`)).toEqual([]);
	});

	it("declares a validator for every operation the service publishes", async () => {
		const compiled = await compileFixture(here, "service");
		const schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");

		/**
		 * ⚠️ **These identifiers used to be emitted by the SERVER generator, into the server file.** A
		 * package advertising TypeSpec HTTP → Zod produced component schemas and nothing a caller could
		 * check a request or a response against. This arm is what holds that fixed.
		 */
		const operations = [
			"readWidget",
			"listWidgets",
			"createWidget",
			"deleteWidget",
			"setFlags",
			"addShape",
			"addTree",
			"health",
			"widgetExists",
		];
		const missing = operations.filter(
			(id) => !new RegExp(`^export const ${id}Responses = `, "m").test(schemas),
		);
		expect(missing).toEqual([]);

		// Non-vacuity: if the naming ever stops emitting, every arm above passes on an empty file.
		const declared = [...schemas.matchAll(/^export const (\w+) = /gm)].map((m) => m[1] ?? "");
		expect(declared.length).toBeGreaterThanOrEqual(25);
	});

	it("names the request validators the document's own wire names imply", async () => {
		const compiled = await compileFixture(here, "service");
		const schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");

		/**
		 * ⚠️ **A header validator keyed on the PROPERTY name rejects every conformant request.**
		 * `@header("x-request-id") requestId` arrives as `x-request-id`; a validator built from the
		 * TypeSpec property name checks a key that is never present. Measured against a real server
		 * once: 400 emitted where the document said 200.
		 */
		expect(schemas).toMatch(/readWidgetHeader\b/);
		expect(schemas).toMatch(/"x-request-id"/);

		/**
		 * ⚠️ **Asserted as wire-name-PRESENT and property-name-ABSENT, because either alone is weak.**
		 * `@query("$select") select` arrives as `$select`; a validator keyed on `select` checks a key
		 * that is never sent. Matching only the wire name would also pass if the emitter emitted both.
		 *
		 * The key is unquoted — `$` is a valid identifier start, so quoting it would be noise — which is
		 * why this reads the key position rather than a quoted literal. Asserting `"$select"` was this
		 * arm's own first mistake: the emitter was right and the test was wrong.
		 */
		expect(schemas).toMatch(/^\t\$select: /m);
		expect(schemas).not.toMatch(/^\t"?select"?: /m);
	});

	it("emits the response arms as a checked literal, not a bare array", async () => {
		const compiled = await compileFixture(here, "service");
		const schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");

		/**
		 * ⚠️ **`satisfies` rather than `as const`, and the difference is measurable.** Both narrow
		 * `status: "default"` so it does not widen to `string`. Only `satisfies` catches a misspelled or
		 * omitted `schema` — under `as const` a bodyless arm is legitimate, so the typo yields a
		 * valid-looking arm that validates nothing.
		 */
		const arms = [...schemas.matchAll(/satisfies readonly ResponseArm\[\]/g)];
		expect(arms.length).toBeGreaterThanOrEqual(9);
		expect(schemas).toMatch(/^import type \{ ResponseArm \} from /m);
	});

	it("gives the overlapping-status operation all four of its declared arms", async () => {
		const compiled = await compileFixture(here, "service");
		const schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");

		/**
		 * `setFlags` declares `Widget | NotFound | Throttled | Unexpected` — 200, 404, a `4XX` range and
		 * `default`, three of which describe a 404. All four must be present and in OpenAPI's precedence
		 * order, because that ordering is what lets a consumer take the first match.
		 *
		 * ⚠️ **The range arm was emitted NOWHERE for the whole life of the un-split emitter.**
		 * `HttpStatusCodesEntry` has three cases and only two were handled, so a declared class of
		 * failures had no validator, was not refused, and produced no warning.
		 */
		const line = schemas.match(/^export const setFlagsResponses = .*$/m)?.[0] ?? "";
		expect(line).not.toBe("");
		const statuses = [...line.matchAll(/status: ("?[\dA-Zx]+"?|"default")/g)].map((m) => m[1]);
		expect(statuses).toEqual(["200", "404", '"4XX"', '"default"']);
	});
});
