import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Two merges, each held to the document or the compiler it disagreed with.** Each fixture is a
 * minimal spec cut down from a seeded generated one: a merged union written with different members by
 * the validator and the contract type (`d-`), and a subtype's views validated as declared under a
 * base openapi3 publishes split (`p-`). Compiled sealed and open, and graded by Ajv on the document
 * openapi3 publishes from the same program.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

interface Loaded {
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
	readonly byDocument: (component: string, value: unknown) => boolean;
}

const loaded = new Map<string, Loaded>();

async function load(name: string, sealed: boolean): Promise<Loaded> {
	const compiled = await compileFixture(here, name, {
		outName: `${name}-${sealed ? "sealed" : "open"}`,
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
	) as { components?: object };
	const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
	const byDocument = (component: string, value: unknown): boolean =>
		ajv.validate(
			{ $ref: `#/components/schemas/${component}`, components: document.components },
			value,
		);
	return { compiled, schemas, byDocument };
}

const FIXTURES = ["d-merged-alike-members", "p-split-partly-redeclared"];

beforeAll(async () => {
	for (const name of FIXTURES) {
		for (const sealed of [true, false]) loaded.set(`${name}:${sealed}`, await load(name, sealed));
	}
}, 900_000);

const of = (name: string, sealed: boolean): Loaded => {
	const found = loaded.get(`${name}:${sealed}`);
	if (found === undefined) throw new Error(`no fixture ${name}`);
	return found;
};

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

/** Every value graded against the document's component, in both seal modes. */
function graded(name: string, cases: Record<string, readonly unknown[]>): void {
	for (const sealed of [true, false]) {
		const fixture = of(name, sealed);
		for (const [component, values] of Object.entries(cases)) {
			const schema = fixture.schemas[`${lowerFirst(component)}Schema`];
			expect(schema, `${name} ${component}`).toBeDefined();
			for (const value of values) {
				expect(
					schema?.safeParse(value).success,
					`${name} sealed=${sealed} ${component} ${JSON.stringify(value)}`,
				).toBe(fixture.byDocument(component, value));
			}
		}
	}
}

describe("a merged union whose members are alike as TypeScript and apart as Zod", () => {
	const name = "d-merged-alike-members";

	it("is written with the same members on both sides, so the emitted set compiles", () => {
		for (const sealed of [true, false]) {
			const { output, failed } = typecheckEmitted(of(name, sealed).compiled.outDir);
			expect(output, `sealed=${sealed}`).toBe("");
			expect(failed).toBe(false);
		}
	});

	it("validates as the document publishes it", () => {
		const u = [{}, { b: "ab" }, { b: "a" }, { g: "x" }, { b: "ab", g: "x" }, { c: "green" }, 5];
		graded(name, {
			LeafB: u.map((each) => ({ u: each })),
			LeafBUpdate: [{}, ...u.map((each) => ({ u: each }))],
		});
	});
});

describe("a subtype redeclaring one of the keys its base's schema misreads, and not another", () => {
	const name = "p-split-partly-redeclared";

	it("is refused in every view, as its base is", () => {
		for (const sealed of [true, false]) {
			const fixture = of(name, sealed);
			expect(
				fixture.compiled.diagnostics.filter((d) => d.code === "typespec-http-zod/split-visibility"),
				`sealed=${sealed}`,
			).toHaveLength(2);
			for (const view of ["sSchema", "sCreateSchema", "sCreateOrUpdateSchema", "bSchema"]) {
				expect(
					fixture.schemas[view]?.safeParse({ name: "a", k: "a", bid: "a" }).success,
					view,
				).toBe(false);
			}
		}
	});

	it("accepts nothing the document refuses", () => {
		const values = [
			{ name: "a", k: "a", bid: "a" },
			{ name: "a", k: "a", bid: 5 },
			{ name: "a", k: "a" },
			{},
		];
		for (const sealed of [true, false]) {
			const fixture = of(name, sealed);
			for (const component of ["S", "SCreate", "SCreateOrUpdate", "B"]) {
				for (const value of values) {
					if (fixture.byDocument(component, value)) continue;
					expect(
						fixture.schemas[`${lowerFirst(component)}Schema`]?.safeParse(value).success,
						`sealed=${sealed} ${component} ${JSON.stringify(value)}`,
					).toBe(false);
				}
			}
		}
	});
});
