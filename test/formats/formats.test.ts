import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/** See `formats.tsp`. The type is honoured; the annotation is not. */

const here = fileURLToPath(new URL(".", import.meta.url));
let schemas: string;
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "formats", { outName: "formats" });
	schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
}, 300_000);

/** The emitted expression for one property of `thingSchema`. */
function propertyOf(name: string): string {
	return new RegExp(`\\n\\t${name}: ([^\\n]+),`).exec(schemas)?.[1] ?? "";
}

describe("a scalar whose type the document publishes as a format", () => {
	it("emits the property expressions this suite reads", () => {
		// Non-vacuity: every assertion below reads one of these.
		for (const name of ["when", "link", "plain", "id"]) {
			expect(propertyOf(name), `no expression found for ${name}`).not.toBe("");
		}
	});

	it("checks a utcDateTime as an instant, accepting every legal offset", () => {
		/**
		 * `{ offset: true }` is measured, not decorative: a bare `z.iso.datetime()` rejects
		 * `2026-08-14T12:00:00+01:00`, which the document permits, and refusing a conformant caller is
		 * worse than the gap being closed.
		 */
		expect(propertyOf("when")).toContain("z.iso.datetime({ offset: true })");
	});

	it("checks a url as a url", () => {
		expect(propertyOf("link")).toContain("z.url()");
	});

	it("leaves a plain string alone", () => {
		expect(propertyOf("plain")).toBe("z.string()");
	});

	it("leaves an @format ANNOTATION unenforced, because a hint is not a claim", () => {
		expect(propertyOf("id")).toBe("z.string()");
	});
});
