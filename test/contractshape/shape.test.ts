import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/** See `shape.tsp`. Both defects made the emitter's own assertion fail on its own output. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let requests: string;

beforeAll(async () => {
	compiled = await compileFixture(here, "shape", { outName: "contractshape" });
	requests = readFileSync(join(compiled.outDir, "requests.gen.ts"), "utf8");
}, 300_000);

describe("the request type and its validator describe one shape", () => {
	it("emits the request types this suite reads", () => {
		for (const name of ["UploadInput", "OpenRequest", "ClosedRequest"]) {
			expect(requests, `${name} is missing`).toContain(name);
		}
	});

	it("carries a multipart body's PARTS, not just its headers", () => {
		const input = /export type UploadInput = Simplify<([\s\S]*?)>;/.exec(requests)?.[1] ?? "";
		expect(input, "no UploadInput found").not.toBe("");
		expect(input).toContain("file:");
		expect(input).toContain("alt?:");
	});

	it("unwraps HttpPart, matching what the validator walks", () => {
		// `file: {}` would be the HttpPart wrapper; the validator unwraps to the part's own type.
		expect(requests).not.toMatch(/file: \{\};/);
	});

	it("gives an open model the catchall its .loose() schema infers", () => {
		expect(requests).toMatch(/interface OpenRequest \{[\s\S]*?\[key: string\]: unknown;[\s\S]*?\}/);
	});

	it("gives a closed model none, so nothing was invented", () => {
		const closed = /interface ClosedRequest \{([\s\S]*?)\}/.exec(requests)?.[1] ?? "";
		expect(closed, "no ClosedRequest found").not.toBe("");
		expect(closed).not.toContain("[key: string]");
	});
});
