import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A published `pattern` is read with the Unicode flag, and the emitted one was not.**
 *
 * A JSON Schema `pattern` is an ECMA-262 expression and a reader compiles it with `u`; Ajv does by
 * default. `patternToRegex` emitted a bare `/.../`, which makes `\p{L}` an identity escape for the
 * letter `p` rather than a Unicode property. So the server ran a different expression from the one
 * the spec author wrote, and from the one the document publishes. Measured against Ajv, every
 * verdict was inverted: `"abc"` VALID in the document and INVALID here, `"p{L}"` the reverse.
 *
 * The flag is carried whenever the pattern compiles under it. It cannot be carried unconditionally:
 * `u` makes a redundant `\-`, a lone `]` or `{`, and an identity escape like `\a` into errors, and
 * 5 of 15 realistic patterns tested fail on it. Those keep the bare form and are named by
 * `non-unicode-pattern`, because a reader of the document cannot compile them either.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let source = "";
let schemas: Record<string, unknown> = {};
let codes: readonly string[] = [];

beforeAll(async () => {
	const compiled = await compileFixture(here, "unicode", { outName: "unicode" });
	codes = compiled.diagnostics.map((d) => d.code);
	source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
}, 600_000);

const namesSchema = (): ZodType => schemas["namesSchema"] as ZodType;
const ok = { letters: "abc", signed: "-42", plain: "abc" };
const accepts = (key: string, value: string): boolean =>
	namesSchema().safeParse({ ...ok, [key]: value }).success;

describe("a pattern carries the Unicode flag when the pattern accepts it", () => {
	it("emits the flag for a pattern that needs it", () => {
		expect(source).toMatch(/letters: z\.string\(\)\.regex\(\/\^\\p\{L\}\+\$\/u\)/);
	});

	it("omits it for a pattern the flag cannot compile, rather than emitting something that throws", () => {
		expect(source).toMatch(/signed: z\.string\(\)\.regex\(\/\^\\-\?\\d\+\$\/\)/);
	});

	/**
	 * The behavioural half. Asserting the emitted text alone would pass on output that carries the
	 * flag and still refuses every letter, which is what the defect looked like from the inside.
	 */
	it("matches a Unicode letter, which without the flag it refused", () => {
		expect(accepts("letters", "abc")).toBe(true);
		expect(accepts("letters", "Zurich")).toBe(true);
	});

	it("refuses the literal text of the escape, which without the flag it accepted", () => {
		expect(accepts("letters", "p{L}")).toBe(false);
	});

	it("leaves an ASCII-only pattern behaving as it did", () => {
		expect(accepts("plain", "abc")).toBe(true);
		expect(accepts("plain", "ABC")).toBe(false);
	});

	/**
	 * **"Valid under both flags" does NOT mean "behaves the same under both", and the difference is
	 * a defect in the same direction as the rest of this file.**
	 *
	 * Under the flag, `.` and a quantifier count whole code points; without it they count UTF-16
	 * units, so an astral character is two. Measured on `^.{3}$` against `"a<emoji>b"`, four
	 * characters of UTF-16 and three of text:
	 *
	 * ```
	 * document (Ajv)   VALID
	 * without the flag INVALID
	 * with the flag    VALID
	 * ```
	 *
	 * Three of seven patterns tested that compile under both flags answered differently on astral
	 * input, and the document agreed with the flag in every one. So carrying it fixes more than the
	 * property escapes that prompted it, and an emoji in a name or a label is how a caller meets it.
	 */
	it("counts an astral character once, as the document does", () => {
		const astral = schemas["astralSchema"] as ZodType;
		expect(astral.safeParse({ three: "a\u{1F600}b" }).success).toBe(true);
		expect(astral.safeParse({ three: "abc" }).success).toBe(true);
		expect(astral.safeParse({ three: "abcd" }).success).toBe(false);
	});

	it("goes on enforcing the pattern it could not carry the flag for", () => {
		expect(accepts("signed", "-42")).toBe(true);
		expect(accepts("signed", "abc")).toBe(false);
	});

	/**
	 * Exactly one: the fixture carries three patterns and only `signed` is uncompilable, so a check
	 * that fired on all three, or on none, would be the same arm passing for the wrong reason.
	 */
	it("names the pattern a reader of the document cannot compile, and only that one", () => {
		expect(codes.filter((code) => code.endsWith("non-unicode-pattern"))).toHaveLength(1);
	});
});
