import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A `@cookie` reached no validator and no diagnostic.**
 *
 * `HttpOperationParameter` discriminates on `"header" | "cookie" | "query" | "path"`. Two filters
 * here named three of the four - one for the validators, one for the contract types - and both
 * excluded cookie by omission rather than by a `never` check, so TypeScript never objected. The
 * document published `in: cookie, required: true` throughout.
 *
 * **No oracle could have caught it**, which is the part worth recording: `@typespec/http-specs`
 * contains no `@cookie`, so the conformance differential compared every location the corpus has and
 * agreed with the document about all of them.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let source = "";

beforeAll(async () => {
	compiled = await compileFixture(here, "cookies");
	source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
}, 120_000);

describe("cookie parameters are emitted as their own group", () => {
	it("compiles clean, and mints a Cookie schema per operation that declares one", () => {
		expect(compiled.diagnostics).toEqual([]);
		for (const name of ["Sessions_readCookie", "Sessions_maybeCookie", "Sessions_typedCookie"]) {
			expect(schemas[name], name).toBeDefined();
		}
	});

	it("keeps them in their own group rather than folding them into the header one", () => {
		/**
		 * The locations are separate in the document and separate on the wire, and a server mounts one
		 * validator per location. Merged, a cookie would be read from a header of the same name.
		 */
		expect(source).not.toMatch(/Sessions_readHeader/);
		expect(schemas["Sessions_readCookie"]?.safeParse({ session: "s" }).success).toBe(true);
	});

	it("enforces the optionality the document publishes", () => {
		// `@cookie session: string` is `required: true`; absent is not a request the contract permits.
		expect(schemas["Sessions_readCookie"]?.safeParse({}).success).toBe(false);
		// `@cookie trace?: string` is `required: false`, so absent is legitimate.
		expect(schemas["Sessions_maybeCookie"]?.safeParse({}).success).toBe(true);
	});

	it("decodes and constrains a cookie the way every other text location is", () => {
		const typed = schemas["Sessions_typedCookie"];
		/**
		 * A cookie arrives as text like a header does, so an `int32` has to be decoded rather than
		 * refused - the defect that once answered 400 to every conformant numeric path parameter.
		 */
		expect(typed?.safeParse({ count: "5", name: "abc" })).toMatchObject({
			success: true,
			data: { count: 5, name: "abc" },
		});
		// And a constraint the document publishes is enforced here too.
		expect(typed?.safeParse({ count: "5", name: "ab" }).success).toBe(false);
		// Decoding is not coercion: a value that is not a number stays refused.
		expect(typed?.safeParse({ count: "", name: "abc" }).success).toBe(false);
	});
});
