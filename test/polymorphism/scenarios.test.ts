import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **The bodies `@typespec/http-specs` declares for a discriminated base, through the response arm a
 * server checks them with.**
 *
 * `type/model/inheritance/enum-discriminator`, `single-discriminator` and `nested-discriminator`
 * each serve a body whose discriminator names no subtype, and one whose discriminator is missing.
 * The first was refused by every open base here, so a handler returning the scenario's own response
 * failed its response contract with 500 (typespec-http-graphql, 2026-10-16).
 *
 * **The bodies are the mocks' own, written out below**, and every verdict is graded by Ajv against
 * the operation's 200 schema in the document openapi3 publishes from the same spec.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const specs = join(
	dirname(createRequire(import.meta.url).resolve("@typespec/http-specs/package.json")),
	"specs/type/model/inheritance",
);

/** scenario, operation id, the path the operation is served at, the mock's body, the verdict. */
const CASES: readonly (readonly [string, string, string, unknown, boolean])[] = [
	[
		"enum-discriminator",
		"getExtensibleModelWrongDiscriminator",
		"/type/model/inheritance/enum-discriminator/extensible-enum/wrongdiscriminator",
		{ weight: 8, kind: "wrongKind" },
		true,
	],
	[
		"enum-discriminator",
		"getExtensibleModelMissingDiscriminator",
		"/type/model/inheritance/enum-discriminator/extensible-enum/missingdiscriminator",
		{ weight: 10 },
		false,
	],
	[
		"enum-discriminator",
		"getFixedModelWrongDiscriminator",
		"/type/model/inheritance/enum-discriminator/fixed-enum/wrongdiscriminator",
		{ length: 8, kind: "wrongKind" },
		false,
	],
	[
		"enum-discriminator",
		"getFixedModelMissingDiscriminator",
		"/type/model/inheritance/enum-discriminator/fixed-enum/missingdiscriminator",
		{ length: 10 },
		false,
	],
	[
		"single-discriminator",
		"getWrongDiscriminator",
		"/type/model/inheritance/single-discriminator/wrongdiscriminator",
		{ wingspan: 1, kind: "wrongKind" },
		true,
	],
	[
		"single-discriminator",
		"getMissingDiscriminator",
		"/type/model/inheritance/single-discriminator/missingdiscriminator",
		{ wingspan: 1 },
		false,
	],
	[
		"nested-discriminator",
		"getWrongDiscriminator",
		"/type/model/inheritance/nested-discriminator/wrongdiscriminator",
		{ age: 1, kind: "wrongKind" },
		true,
	],
	[
		"nested-discriminator",
		"getMissingDiscriminator",
		"/type/model/inheritance/nested-discriminator/missingdiscriminator",
		{ age: 1 },
		false,
	],
];

interface Compiled {
	readonly schemas: Record<string, unknown>;
	readonly byDocument: (path: string, value: unknown) => boolean;
	readonly diagnostics: readonly { readonly code: string }[];
}

const compiled = new Map<string, Compiled>();

beforeAll(async () => {
	for (const scenario of new Set(CASES.map(([name]) => name))) {
		const fixture = await compileFixture(join(specs, scenario), "main", {
			outDir: join(here, ".out", "scenarios", scenario),
		});
		const [record] = await getOpenAPI3(fixture.program, { "openapi-versions": ["3.1.0"] });
		const document = JSON.parse(
			JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
		) as {
			components: Record<string, unknown>;
			paths: Record<
				string,
				{ get: { responses: { "200": { content: { "application/json": { schema: unknown } } } } } }
			>;
		};
		const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
		compiled.set(scenario, {
			schemas: (await import(join(fixture.outDir, "schemas.gen.ts"))) as Record<string, unknown>,
			diagnostics: fixture.diagnostics,
			byDocument: (path, value) =>
				ajv.validate(
					{
						...(document.paths[path]?.get.responses["200"].content["application/json"].schema as {
							$ref: string;
						}),
						components: document.components,
					},
					value,
				),
		});
	}
}, 300_000);

describe("each declared body of a discriminated base, through its response arm", () => {
	it("compiles each scenario without a diagnostic", () => {
		expect([...compiled.values()].flatMap((scenario) => scenario.diagnostics)).toEqual([]);
	});

	for (const [scenario, operation, path, body, expected] of CASES) {
		it(`${scenario} ${operation}: ${expected ? "accepts" : "refuses"} ${JSON.stringify(body)}, as the document does`, () => {
			const { schemas, byDocument } = compiled.get(scenario) as Compiled;
			const arms = schemas[`${operation}Responses`] as readonly {
				status: number;
				schema: ZodType;
			}[];
			const arm = arms.find((candidate) => candidate.status === 200);
			expect(byDocument(path, body)).toBe(expected);
			expect(arm?.schema.safeParse(body).success).toBe(expected);
		});
	}
});
