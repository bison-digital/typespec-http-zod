import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/** See `arms.tsp`. Both facts are published by the document and neither reached `deps.respond`. */

const here = fileURLToPath(new URL(".", import.meta.url));

let compiled: CompiledFixture;
let schemas: string;

beforeAll(async () => {
	compiled = await compileFixture(here, "arms", { outName: "arms" });
	schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
}, 300_000);

/** The arm list for one operation, as emitted text, so the assertions are about one operation. */
function armsFor(operationId: string): string {
	return (
		new RegExp(`const ${operationId}Responses = (\\[[\\s\\S]*?\\]) satisfies`).exec(schemas)?.[1] ??
		""
	);
}

describe("a response arm carries what the document declares about it", () => {
	it("emits an arm list per operation at all", () => {
		// Non-vacuity: every assertion below reads one of these.
		for (const id of ["go", "create", "plain", "discovery"]) {
			expect(armsFor(id), `no arms emitted for ${id}`).not.toBe("");
		}
	});

	it("carries the headers a redirect declares", () => {
		expect(armsFor("go")).toMatch(/headers:/);
		expect(armsFor("go")).toContain("location");
	});

	it("carries headers beside a body rather than instead of one", () => {
		const arms = armsFor("create");
		expect(arms).toContain("location");
		expect(arms).toContain("x-correlation-id");
		expect(arms).toMatch(/schema: noteSchema/);
	});

	it("pairs the wire name with the property the value is read from", () => {
		/**
		 * **Both names, and the pairing is the assertion.** The response sets `x-correlation-id`; the
		 * value lives at `correlationId` on what the handler returned. An arm carrying only one of them
		 * would make every `respond` implementation guess the other, and the two differ exactly when
		 * `@header("...")` renames - which is the common case for any header with a hyphen.
		 */
		expect(armsFor("create")).toContain('{ name: "x-correlation-id", property: "correlationId" }');
		// The un-renamed one still pairs, rather than being special-cased away.
		expect(armsFor("create")).toContain('{ name: "location", property: "location" }');
	});

	it("gives an arm declaring no headers none, so nothing was invented", () => {
		expect(armsFor("plain")).not.toMatch(/headers:/);
	});

	it("carries every media type a status offers, not just the first", () => {
		const arms = armsFor("discovery");
		expect(arms).toContain("application/json");
		expect(arms).toContain("text/html");
	});

	it("leaves a single-media-type arm alone, because one type is what respond assumes", () => {
		expect(armsFor("plain")).not.toMatch(/contentTypes:/);
	});
});
