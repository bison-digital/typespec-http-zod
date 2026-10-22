import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture } from "../../support/compile-fixture.js";

/**
 * **A union that reaches itself through union members alone is refused, wherever it is used.**
 * `union string { int32, string }` in a namespace names itself, not the scalar, and openapi3
 * publishes `anyOf: [int32, { $ref: string }]` - a schema JSON Schema leaves undefined, on which Ajv
 * overflows its stack for every value. Used as a query parameter, a header, a path parameter or a form
 * field, the emitter crashed with "Maximum call stack size exceeded"; as a body property it emitted a
 * type alias TypeScript refuses and a `z.lazy` that recursed on every value but an integer.
 *
 * A cycle that passes through a list, a record, an object or an envelope is a recursive type like
 * any other, and is graded by Ajv on the document openapi3 publishes.
 *
 * A multipart part or a default of the same union crashes `@typespec/http` or the compiler before any
 * emitter runs, so neither is here.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

/** Named, so the helper writes no barrel into a directory a refused service never creates. */
const refused = (name: string) => compileFixture(here, name, { contractsPackage: "unused" });

const refusals = (program: Awaited<ReturnType<typeof compileFixture>>["program"]): string[] =>
	program.diagnostics
		.filter((each) => each.code === "typespec-http-zod/unsupported-type")
		.map((each) => (typeof each.message === "string" ? each.message : ""));

describe("a union reaching itself through unions alone", () => {
	it.each(["body", "query", "header", "path", "form"])(
		"is refused, and nothing written, as a %s",
		async (position) => {
			const { program, outDir } = await refused(`self-${position}`);
			const messages = refusals(program);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toContain("reach 'N.string' again through unions alone");
			expect(messages[0]).toContain("'TypeSpec.string' names the scalar");
			expect(program.diagnostics.map((each) => each.code)).toEqual([
				"typespec-http-zod/unsupported-type",
			]);
			expect(existsSync(outDir)).toBe(false);
		},
		300_000,
	);

	it("is refused on every union of a cycle, reached or not, and on no union only reaching one", async () => {
		const { program } = await refused("mutual");
		const named = refusals(program).map((message) => /reach '([^']+)'/.exec(message)?.[1]);
		expect(named.toSorted()).toEqual(["N.A", "N.B", "N.C", "N.D", "N.Unreached"]);
		expect(program.diagnostics).toHaveLength(5);
	}, 300_000);

	it("is not refused outside every service", async () => {
		const { program, outDir } = await compileFixture(here, "outside");
		expect(program.diagnostics).toEqual([]);
		expect(existsSync(join(outDir, "schemas.gen.ts"))).toBe(true);
	}, 300_000);
});

describe("a recursive union that passes through a value", () => {
	for (const sealed of [true, false]) {
		it(`validates as the document publishes it, sealed=${sealed}`, async () => {
			const compiled = await compileFixture(here, "guarded", {
				outName: `guarded-${sealed ? "sealed" : "open"}`,
				extraOptions: { "seal-object-schemas": sealed },
			});
			expect(compiled.diagnostics).toEqual([]);
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
			) as { components?: object };
			const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
			const cases: Record<string, readonly unknown[]> = {
				A: [5, [5], [[5, [6]]], [], "x", ["x"], null],
				B: [5, {}, { x: 5 }, { x: { x: 6 } }, { x: "y" }, { y: 1 }, null],
				C: [
					{ kind: "b", value: { n: 1 } },
					{ kind: "a", value: { kind: "b", value: { n: 1 } } },
					{ kind: "a", value: 5 },
					{ kind: "c", value: { n: 1 } },
				],
				R: [5, {}, { k: 5 }, { k: { j: 6 } }, { k: "x" }, [5]],
				G: [5, { kind: "g", value: 6 }, { kind: "g", value: { kind: "g", value: 7 } }, "x"],
			};
			for (const [component, values] of Object.entries(cases)) {
				const schema = schemas[`${component.toLowerCase()}Schema`];
				expect(schema, component).toBeDefined();
				for (const value of values) {
					expect(schema?.safeParse(value).success, `${component} ${JSON.stringify(value)}`).toBe(
						ajv.validate(
							{ $ref: `#/components/schemas/${component}`, components: document.components },
							value,
						),
					);
				}
			}
		}, 300_000);
	}
});
