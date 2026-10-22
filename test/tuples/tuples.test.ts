import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A tuple validates as the `prefixItems` openapi3 publishes for it.** See `tuples.tsp`.
 *
 * 0.31.0's first answer refused every tuple, which was safe while only an operation's types were
 * declared. Every component the document publishes is declared now, and an OAuth2 flow model - a
 * `scopes` tuple, published as a component though no operation reaches it - stopped a service using
 * `OAuth2Auth` compiling. The document's schema has no `items` and no `minItems`, so any length is
 * valid, each position is checked where it is present, and anything past the last is accepted. A
 * parameter or a header is text on the wire, read as no positions, and stays refused.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

interface Mode {
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
	readonly byDocument: (component: string, value: unknown) => boolean;
}

async function load(sealed: boolean): Promise<Mode> {
	const outName = sealed ? "tuples-sealed" : "tuples-open";
	const compiled = await compileFixture(here, "tuples", {
		outName,
		extraOptions: { "seal-object-schemas": sealed },
	});
	const schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
		string,
		ZodType
	>;
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		"seal-object-schemas": sealed,
	});
	const document = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as { components: Record<string, unknown> };
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	const byDocument = (component: string, value: unknown): boolean =>
		ajv.validate(
			{ $ref: `#/components/schemas/${component}`, components: document.components },
			value,
		);
	return { compiled, schemas, byDocument };
}

let modes: Mode[];

beforeAll(async () => {
	modes = [await load(true), await load(false)];
}, 300_000);

const shapes = (overrides: Record<string, unknown>): Record<string, unknown> => ({
	pair: [1, "a"],
	empty: [],
	nullable: [null, { x: 1, y: 2 }],
	literal: ["a", 1, true],
	points: [
		[
			{ x: 1, y: 2 },
			{ x: 3, y: 4 },
		],
	],
	...overrides,
});

describe("a tuple", () => {
	it("is refused only as a parameter and a header, each once", () => {
		for (const { compiled } of modes) {
			const refused = compiled.program.diagnostics.filter((d) => d.severity === "error");
			expect(refused.map((d) => d.code)).toEqual([
				"typespec-http-zod/unsupported-type",
				"typespec-http-zod/unsupported-type",
			]);
			for (const each of refused) {
				expect(each.message).toContain("a parameter typed as a tuple");
				expect(each.message).toContain("Declare the parameter as a list of one element type");
			}
		}
	});

	it("validates every position present, any length, and anything past the last, as the document does", () => {
		const values: Record<string, unknown>[] = [
			shapes({}),
			shapes({ pair: [] }),
			shapes({ pair: [1] }),
			shapes({ pair: [1, "a", "extra", 3] }),
			shapes({ pair: ["a", 1] }),
			shapes({ pair: [1.5, "a"] }),
			shapes({ pair: "1,a" }),
			shapes({ empty: [1, "x", null] }),
			shapes({ nullable: ["s", { x: 1, y: 2 }] }),
			shapes({ nullable: [null, { x: 1 }] }),
			shapes({ nullable: [1] }),
			shapes({ literal: ["b"] }),
			shapes({ literal: ["a", 2] }),
			shapes({ literal: ["a", 1, false, "rest"] }),
			shapes({ points: [[{ x: 1, y: 2 }], []] }),
			shapes({ points: [[{ x: 1, y: "2" }]] }),
			shapes({ maybe: [] }),
			shapes({ maybe: [true, "rest"] }),
			shapes({ maybe: ["true"] }),
			shapes({ maybe: null }),
		];
		for (const { schemas, byDocument } of modes) {
			for (const value of values) {
				const result = schemas.shapesSchema?.safeParse(value);
				expect(result?.success, JSON.stringify(value)).toBe(byDocument("Shapes", value));
				if (result?.success === true) expect(result.data).toEqual(value);
			}
			for (const value of [{ range: [1, 2] }, { range: [] }, { range: [1, "2"] }, {}]) {
				expect(schemas.windowSchema?.safeParse(value).success, JSON.stringify(value)).toBe(
					byDocument("Window", value),
				);
			}
			for (const value of [
				{ type: "implicit", scopes: ["read", "write"] },
				{ type: "implicit", scopes: [] },
				{ type: "implicit", scopes: ["read", "write", "admin"] },
				{ type: "implicit", scopes: ["write"] },
				{ type: "implicit" },
			]) {
				expect(schemas.flowSchema?.safeParse(value).success, JSON.stringify(value)).toBe(
					byDocument("Flow", value),
				);
			}
		}
	});

	it("states a refused parameter and header as nothing, in its validator and its contract type alike", () => {
		for (const { compiled, schemas } of modes) {
			for (const q of ["1,a", ["1", "a"], [1, "a"]]) {
				expect(schemas.queryQuery?.safeParse({ q }).success, JSON.stringify(q)).toBe(false);
			}
			expect(schemas.queryQuery?.safeParse({}).success).toBe(true);
			expect(schemas.headerResponse200Headers?.safeParse({ "x-pair": "1,a" }).success).toBe(false);
			const contracts = readFileSync(join(compiled.outDir, "requests.gen.ts"), "utf8");
			expect(contracts).toContain('readonly headers: { readonly "x-pair": never }');
		}
	});

	it("typechecks with its contract type, the wire contract included", () => {
		for (const { compiled } of modes) {
			const { output, failed } = typecheckEmitted(compiled.outDir);
			expect(output).toBe("");
			expect(failed).toBe(false);
		}
	});
});
