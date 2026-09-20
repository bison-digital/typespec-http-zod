import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A pattern containing a forward slash emitted a module that does not parse.**
 *
 * `patternToRegex` escaped every slash unconditionally, so a pattern that already spelled one as
 * an escape had its backslash doubled. `^\/api\/v[0-9]+$` became the literal
 * `/^\\/api\\/v[0-9]+$/u`, where the regex ends at the third slash and `api` is read as flags.
 * Measured: `tsp compile` EXIT=0 and silent, `node` refused the emitted module with
 * `SyntaxError: Invalid regular expression flags`, and `tsc` reported `TS1127: Invalid character`.
 *
 * It was invisible because nothing had ever put a slash in a pattern here. A path regex is the
 * most ordinary place one appears.
 *
 * The import in `beforeAll` is itself the sharpest arm in this file: a malformed regex literal
 * cannot be imported at all, so every arm below fails at once if the escaping regresses.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let source = "";
let schemas: Record<string, unknown> = {};

beforeAll(async () => {
	const compiled = await compileFixture(here, "patterns", { outName: "patterns" });
	expect(compiled.diagnostics).toEqual([]);
	source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
}, 600_000);

const ok = { escaped: "/api/v1", bare: "/api/v1", literalBackslash: "a\\/b", plain: "abc" };
const accepts = (key: string, value: string): boolean =>
	(schemas["routesSchema"] as ZodType).safeParse({ ...ok, [key]: value }).success;

describe("a pattern containing a forward slash", () => {
	it("emits a module that can be imported at all, which a doubled backslash stopped", () => {
		expect(schemas["routesSchema"]).toBeDefined();
	});

	it("enforces the escaped spelling against the path it describes", () => {
		expect(accepts("escaped", "/api/v1")).toBe(true);
		expect(accepts("escaped", "/api/v22")).toBe(true);
	});

	it("refuses what that pattern forbids, so the escaping did not turn it into something permissive", () => {
		expect(accepts("escaped", "/api/vX")).toBe(false);
		expect(accepts("escaped", "api/v1")).toBe(false);
		expect(accepts("escaped", "/other/v1")).toBe(false);
	});

	it("gives the bare spelling the same meaning as the escaped one", () => {
		expect(accepts("bare", "/api/v1")).toBe(true);
		expect(accepts("bare", "/api/vX")).toBe(false);
	});

	it("keeps a literal backslash literal rather than reading it as escaping the slash", () => {
		expect(accepts("literalBackslash", "a\\/b")).toBe(true);
		expect(accepts("literalBackslash", "a/b")).toBe(false);
	});

	it("leaves a pattern with no slash in it untouched", () => {
		expect(accepts("plain", "abc")).toBe(true);
		expect(accepts("plain", "ABC")).toBe(false);
	});

	/**
	 * The textual half. A blanket "no two backslashes before a slash" would be wrong: the literal
	 * backslash above emits exactly that, correctly. The invariant that does hold is that the two
	 * spellings of one expression converge on one regex, which is what the doubling broke.
	 */
	it("emits one regex for both spellings of the same expression", () => {
		const emitted = (property: string): string => {
			const found = new RegExp(`${property}: z\\.string\\(\\)\\.regex\\((.+?)\\),`).exec(source);
			return found?.[1] ?? `NO MATCH FOR ${property}`;
		};
		expect(emitted("escaped")).toBe("/^\\/api\\/v[0-9]+$/u");
		expect(emitted("escaped")).toBe(emitted("bare"));
	});
});
