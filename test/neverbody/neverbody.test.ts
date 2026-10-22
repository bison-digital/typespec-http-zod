import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A body declared `never` is refused, as `never-body`.** See `neverbody.tsp`.
 *
 * `never` has no values, and openapi3 publishes such a body as `application/json` with `schema: {}`,
 * any value at all. A validator could agree with the spec or with the document, not both. 0.30.0
 * read it as no body and listed the divergence; it is refused instead, the way
 * `undeclared-discriminator` refuses a discriminator the document cannot state.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "neverbody", { outName: "neverbody" });
}, 300_000);

describe("a body declared never", () => {
	it("is what the document publishes as any value, which is why it is refused", async () => {
		const [record] = await getOpenAPI3(compiled.program, { "openapi-versions": ["3.1.0"] });
		const document = JSON.parse(
			JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
		) as {
			paths: Record<
				string,
				Record<string, { requestBody?: unknown; responses?: Record<string, unknown> }>
			>;
		};
		expect(document.paths["/responses"]?.["get"]?.responses?.["410"]).toMatchObject({
			content: { "application/json": { schema: {} } },
		});
		expect(document.paths["/never"]?.["post"]?.requestBody).toMatchObject({
			content: { "application/json": { schema: {} } },
		});
	});

	it("is refused once per declaration, as an error, and nothing else is reported", () => {
		expect(compiled.diagnostics).toEqual([
			{ code: "typespec-http-zod/never-body", severity: "error" },
			{ code: "typespec-http-zod/never-body", severity: "error" },
		]);
	});

	it("names the operation and the position", () => {
		const messages = compiled.program.diagnostics.map((d) => d.message);
		expect(messages.some((m) => m.startsWith("'responses' declares a 410 response body"))).toBe(
			true,
		);
		expect(messages.some((m) => m.startsWith("'neverRequest' declares a request body"))).toBe(true);
	});
});
