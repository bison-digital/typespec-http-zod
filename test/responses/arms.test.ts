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

	it("names each header by the WIRE name the response sets, with its optionality", () => {
		/**
		 * **The wire name, and not the TypeSpec property behind it.** The response sets
		 * `x-correlation-id`; the property is `correlationId`. The pair used to be carried so a runtime
		 * could read the value off a flattened result, which made the handler contract depend on a
		 * property name the document never publishes. A result is keyed by what the document states.
		 */
		expect(armsFor("create")).toContain('{ name: "x-correlation-id", optional: false }');
		expect(armsFor("create")).toContain('{ name: "location", optional: false }');
		expect(armsFor("create")).not.toContain("correlationId");
	});

	it("gives an arm declaring no headers none, so nothing was invented", () => {
		expect(armsFor("plain")).not.toMatch(/headers:/);
	});

	it("carries every media type a status offers, not just the first", () => {
		const arms = armsFor("discovery");
		expect(arms).toContain("application/json");
		expect(arms).toContain("text/html");
	});

	it("carries a SINGLE media type too, so a text/plain arm is not mistaken for JSON", () => {
		/**
		 * This asserted the opposite until a consumer showed why: omitting the single type assumed it
		 * was JSON, and a generic `respond` could not tell a `text/plain` arm from a JSON one. The
		 * document knew and the runtime did not.
		 */
		expect(armsFor("plain")).toContain('contentTypes: ["application/json"]');
	});
});
