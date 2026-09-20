import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A declared media range admits the types inside it, and this package owned no arm for that.**
 *
 * The change that made a range match lives in `src/api.ts`, and its only guard lived in
 * `typespec-hono`'s suite, reached through a `node_modules` symlink no repository records.
 * Measured: reverting the whole range branch left all 454 arms here green, and turned two arms
 * in the sibling red. A guard in another repository, behind an undocumented link, is not a guard
 * this package has.
 *
 * The arms are behavioural. Asserting the emitted text would have passed on
 * `z.templateLiteral(["*&#47;", z.string()])`, which is what the full wildcard actually emitted:
 * a schema matching only a literal `*&#47;...`, so every real request was refused.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let source = "";
let schemas: Record<string, unknown> = {};

beforeAll(async () => {
	const compiled = await compileFixture(here, "mediarange", { outName: "mediarange" });
	expect(compiled.diagnostics).toEqual([]);
	source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
}, 600_000);

/** Sends one `Content-Type` through the header schema the emitter wrote for that operation. */
const admits = (operation: string, contentType: string): boolean =>
	(schemas[`${operation}Header`] as ZodType).safeParse({ "Content-Type": contentType }).success;

describe("a declared media range admits the types inside it", () => {
	/**
	 * Non-vacuity. Every refusal below is only evidence if the schemas accept anything at all.
	 */
	it("admits the type a concrete declaration names, so the arms below are not passing on a broken schema", () => {
		expect(admits("putJson", "application/json")).toBe(true);
		expect(admits("putText", "text/plain")).toBe(true);
	});

	/**
	 * `copal-gateway/spec/file.tsp:13`. The whole point of `*&#47;*` is that anything satisfies it.
	 */
	it("admits every media type under the full wildcard, which is the only thing that range means", () => {
		expect(admits("putAny", "application/json")).toBe(true);
		expect(admits("putAny", "text/plain")).toBe(true);
		expect(admits("putAny", "image/png")).toBe(true);
		expect(admits("putAny", "application/vnd.api+json")).toBe(true);
	});

	it("admits every type in a subtype wildcard's group", () => {
		expect(admits("putText", "text/plain")).toBe(true);
		expect(admits("putText", "text/html")).toBe(true);
		expect(admits("putText", "text/markdown")).toBe(true);
	});

	/**
	 * A range is a range and not an escape hatch: without this the arm above passes on
	 * `z.string()`, which admits everything everywhere.
	 */
	it("refuses a type outside a subtype wildcard's group", () => {
		expect(admits("putText", "application/json")).toBe(false);
		expect(admits("putText", "image/png")).toBe(false);
	});

	it("leaves a concrete media type admitting only itself", () => {
		expect(admits("putJson", "text/plain")).toBe(false);
		expect(admits("putJson", "application/xml")).toBe(false);
	});

	it("strips parameters and matches case-insensitively, as media types are", () => {
		expect(admits("putJson", "APPLICATION/JSON")).toBe(true);
		expect(admits("putJson", "application/json; charset=utf-8")).toBe(true);
		expect(admits("putText", "TEXT/HTML; charset=utf-8")).toBe(true);
		expect(admits("putAny", "IMAGE/PNG; q=1")).toBe(true);
	});

	it("emits a range as a range rather than as the literal text of the range", () => {
		expect(source).not.toMatch(/z\.literal\("\*\/\*"\)/);
		expect(source).not.toMatch(/z\.literal\("text\/\*"\)/);
	});
});
