import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A multipart request body is validated, and validated as what the document says it is.**
 *
 * `requestBodyOf` returned a type only for `bodyKind === "single"`, so every multipart operation was
 * mounted with no body validator at all — 19 routes across the conformance corpus and 12 components
 * the document declares that nothing could check. Not a refusal and not a diagnostic: silently
 * unchecked, which is the failure this emitter exists to remove.
 *
 * ⚠️ **A binary part must be `z.unknown()`, and that is the load-bearing choice.** `SCALARS` maps
 * `bytes` to `z.string()`, which is right for a JSON body (base64) and wrong in a part, where the
 * bytes are raw — openapi3 publishes `{}` for it, no type at all. `z.string()` would enforce a rule
 * the document does not state AND reject what a server actually receives, since `c.req.parseBody()`
 * hands back a `File`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a multipart body is checked part by part", () => {
	let schemas: Record<string, ZodType>;
	let compiled: CompiledFixture;
	const accepts = (name: string, value: unknown): boolean =>
		(schemas[name] as ZodType).safeParse(value).success;
	const body = (overrides: Record<string, unknown>): Record<string, unknown> => ({
		id: "abc",
		profileImage: new Uint8Array([1, 2, 3]),
		address: { city: "London" },
		pictures: [new Uint8Array([1])],
		...overrides,
	});

	beforeAll(async () => {
		compiled = await compileFixture(here, "upload");
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	});

	it("compiles and emits a validator for the multipart body", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		// The defect, stated plainly: this used to be `undefined`.
		expect(schemas.uploadSchema).toBeDefined();
	});

	it("accepts a body whose parts are all present and well typed", () => {
		expect(accepts("uploadSchema", body({}))).toBe(true);
	});

	it("enforces a text part's type and its requiredness", () => {
		expect(accepts("uploadSchema", body({ id: 42 }))).toBe(false);
		expect(accepts("uploadSchema", body({ id: undefined }))).toBe(false);
	});

	it("accepts ANY value for a binary part, because the document constrains none", () => {
		// Paired with the text-part arm above, so "accepts anything" is a statement about this part
		// rather than about a validator that checks nothing.
		for (const value of [new Uint8Array([1]), "base64ish", { name: "f.png" }]) {
			expect(accepts("uploadSchema", body({ profileImage: value }))).toBe(true);
		}
		// …but the part must still be PRESENT, which is the half `z.unknown()` alone would lose.
		const { profileImage, ...without } = body({});
		void profileImage;
		expect(accepts("uploadSchema", without)).toBe(false);
	});

	it("validates INSIDE a JSON part", () => {
		expect(accepts("uploadSchema", body({ address: { city: 42 } }))).toBe(false);
		expect(accepts("uploadSchema", body({ address: {} }))).toBe(false);
	});

	it("reads a repeated part as an array, and an optional part as optional", () => {
		expect(accepts("uploadSchema", body({ pictures: new Uint8Array([1]) }))).toBe(false);
		const { caption, ...without } = body({});
		void caption;
		expect(accepts("uploadSchema", without)).toBe(true);
	});

	it("keys a part on its WIRE name", () => {
		// `identifier: HttpPart<string, #{name: "id"}>` goes on the wire as `id`.
		expect(accepts("renamedSchema", { id: "abc" })).toBe(true);
		expect(accepts("renamedSchema", { identifier: "abc" })).toBe(false);
	});
});
