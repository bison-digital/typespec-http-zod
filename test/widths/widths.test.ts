import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A declared integer WIDTH is a claim about the value, and ten of them used to share one check.**
 *
 * Every integer scalar emitted `z.number().int()`, which is "an integer within the safe range" and
 * nothing more. Measured at the wire on `workerd` before this existed: a declared `uint8` accepted
 * `-5` and `100000`, and a declared `int32` accepted `3000000000` and `-3000000000`.
 *
 * **The differential oracle could not see it, and that is the interesting part.** JSON Schema
 * 2020-12 treats `format` as an annotation, so Ajv on the published document answers VALID for all
 * of those and AGREES with the server while both are wrong - Ajv says so out loud, `unknown format
 * "uint8" ignored`. Two artefacts can agree and both be wrong, which is exactly the case a
 * differential cannot reach, so it takes an arm that knows what the width means.
 *
 * `differential.test.ts` now translates a declared width into the bounds that express it, on both
 * sides, so the two artefacts still compare - and a validator that FORGOT a width's bounds diverges
 * there where discarding them would have hidden it.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let schemas: Record<string, unknown> = {};
const schemaOf = (name: string): ZodType => schemas[name] as ZodType;

beforeAll(async () => {
	const compiled = await compileFixture(here, "widths", { outName: "widths" });
	expect(compiled.diagnostics).toEqual([]);
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
}, 600_000);

/** One conformant body, so each arm changes exactly the property it is about. */
const ok = { i8: 1, i16: 1, i32: 1, i64: 1, u8: 1, u16: 1, u32: 1, u64: 1, safe: 1 };
const withValue = (key: string, value: number): Record<string, number> => ({ ...ok, [key]: value });
const accepts = (key: string, value: number): boolean =>
	schemaOf("everySchema").safeParse(withValue(key, value)).success;

describe("a declared integer width is enforced, not annotated", () => {
	it("accepts a body inside every width, so the arms below are not passing on a broken schema", () => {
		expect(schemaOf("everySchema").safeParse(ok).success).toBe(true);
	});

	it("refuses a value above the width's maximum", () => {
		expect(accepts("i8", 128)).toBe(false);
		expect(accepts("i16", 32768)).toBe(false);
		expect(accepts("i32", 2147483648)).toBe(false);
		expect(accepts("u8", 256)).toBe(false);
		expect(accepts("u16", 65536)).toBe(false);
		expect(accepts("u32", 4294967296)).toBe(false);
	});

	it("refuses a negative value in an UNSIGNED width, which is the whole of what unsigned means", () => {
		expect(accepts("u8", -1)).toBe(false);
		expect(accepts("u16", -1)).toBe(false);
		expect(accepts("u32", -1)).toBe(false);
		expect(accepts("u64", -1)).toBe(false);
	});

	it("accepts the boundary itself, so the bounds are the width's and not one off it", () => {
		expect(accepts("i8", 127)).toBe(true);
		expect(accepts("i8", -128)).toBe(true);
		expect(accepts("i32", 2147483647)).toBe(true);
		expect(accepts("i32", -2147483648)).toBe(true);
		expect(accepts("u8", 255)).toBe(true);
		expect(accepts("u8", 0)).toBe(true);
		expect(accepts("u32", 4294967295)).toBe(true);
	});

	/**
	 * `int64` and `uint64` exceed what a JSON number holds: `JSON.parse` has already lost a value
	 * above 2^53 before any validator runs, so refusing it is the honest answer and the alternative
	 * is accepting a number that is not the one the caller sent.
	 */
	it("keeps the safe-integer ceiling on the 64-bit widths, because JSON cannot carry them", () => {
		expect(accepts("i64", Number.MAX_SAFE_INTEGER)).toBe(true);
		expect(accepts("i64", Number.MAX_SAFE_INTEGER + 2)).toBe(false);
		expect(accepts("u64", Number.MAX_SAFE_INTEGER)).toBe(true);
		expect(accepts("safe", Number.MAX_SAFE_INTEGER + 2)).toBe(false);
	});

	it("still refuses a non-integer in every width, which was the one thing it always did", () => {
		for (const key of ["i8", "i32", "i64", "u8", "u32", "safe"]) {
			expect(accepts(key, 1.5), key).toBe(false);
		}
	});

	/**
	 * **The parameter path, which is decided by a prefix list and had no fixture at all.**
	 *
	 * A query parameter arrives as text. The emitter attaches a coercing decoder only to schemas
	 * whose emitted expression starts with a known numeric prefix, and giving each width its own
	 * bounds respelled nine of them. Measured: removing `z.int(` or `z.uint32(` from that list
	 * left every other arm in this package green while these parameters stopped accepting a
	 * number sent as text, which is the only way a caller can send one.
	 */
	it("coerces every width sent as text, which is how a query parameter always arrives", () => {
		const query = schemaOf("paramsQuery");
		const sent = {
			i8: "1",
			i16: "1",
			i32: "1",
			i64: "1",
			u8: "1",
			u16: "1",
			u32: "1",
			u64: "1",
			safe: "1",
			plain: "1",
		};
		const parsed = query.safeParse(sent);
		expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
		expect(parsed.data).toEqual({
			i8: 1,
			i16: 1,
			i32: 1,
			i64: 1,
			u8: 1,
			u16: 1,
			u32: 1,
			u64: 1,
			safe: 1,
			plain: 1,
		});
	});

	/**
	 * Non-vacuity for the arm above: coercion must not have become "accept anything".
	 */
	it("goes on enforcing each width after coercing it, rather than accepting any text", () => {
		const query = schemaOf("paramsQuery");
		const sent = (key: string, value: string): Record<string, string> => ({
			i8: "1",
			i16: "1",
			i32: "1",
			i64: "1",
			u8: "1",
			u16: "1",
			u32: "1",
			u64: "1",
			safe: "1",
			plain: "1",
			[key]: value,
		});
		expect(query.safeParse(sent("u8", "-1")).success).toBe(false);
		expect(query.safeParse(sent("u8", "256")).success).toBe(false);
		expect(query.safeParse(sent("u32", "-1")).success).toBe(false);
		expect(query.safeParse(sent("i8", "128")).success).toBe(false);
		expect(query.safeParse(sent("i32", "3000000000")).success).toBe(false);
		expect(query.safeParse(sent("u8", "notanumber")).success).toBe(false);
	});
});
