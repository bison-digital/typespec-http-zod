import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A single occurrence of an exploded array parameter is a conformant request.** (#1)
 *
 * `zValidator`'s query target hands a repeated key over as an array and a single occurrence as a
 * bare string - and one `key=value` pair is exactly what a one-member exploded array looks like on
 * the wire. The emitted validator used to be a bare `z.array()`, so `?topics=a&topics=b` passed
 * while `?topics=a` came back 400: the same list refused or admitted by its LENGTH, which no
 * document describes.
 *
 * The 0.4.0 describer-free axis cannot redden on this: validator and document agree the type is
 * `array` - the disagreeing pair is *emitted validator vs what `zValidator` actually delivers*, so
 * these arms drive the emitted schema with the delivered shapes themselves. The two controls keep
 * the boxing from quietly spreading: a delimited list still splits, a scalar is never boxed.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("an exploded array parameter accepts a single occurrence", () => {
	let query: ZodType;
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "exploded");
		const module = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
			string,
			ZodType
		>;
		query = module.searchQuery as ZodType;
	});

	it("compiles without an error diagnostic, and emits the query schema", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(query).toBeDefined();
	});

	it("boxes a single occurrence into the one-element array the document describes", () => {
		// The bare string is what zValidator delivers for `?topics=a` - not what the caller sent.
		expect(query.parse({ topics: "a" })).toEqual({ topics: ["a"] });
	});

	it("passes several occurrences through untouched", () => {
		expect(query.parse({ topics: ["a", "b"] })).toEqual({ topics: ["a", "b"] });
	});

	it("still admits the parameter's absence", () => {
		expect(query.parse({})).toEqual({});
	});

	it("still applies the element constraints to a boxed value", () => {
		// Boxing happens BEFORE validation, never instead of it.
		expect(query.safeParse({ topics: 5 }).success).toBe(false);
	});

	it("control: a delimited (non-exploded) list still splits, and is not double-boxed", () => {
		expect(query.parse({ joined: "a,b" })).toEqual({ joined: ["a", "b"] });
	});

	it("control: a scalar parameter is never boxed", () => {
		expect(query.parse({ q: "a" })).toEqual({ q: "a" });
	});
});
