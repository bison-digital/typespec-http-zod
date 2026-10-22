import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **`@oneOf` and merges, each held to the document or the compiler it disagreed with.** Each fixture
 * is a minimal spec, most cut down from a seeded generated one: a property's `@oneOf` lost in a merge,
 * two merged members the validator writes alike and the contract type wrote apart - or the contract
 * type wrote as one, `Record<string, unknown>` twice - and a `@oneOf` whose member is refused, as it
 * is written or further down. Compiled sealed and open, and graded by Ajv on the document openapi3
 * publishes.
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

const FIXTURES = [
	"d-merged-oneof-property",
	"d-merged-identical-members",
	"d-oneof-member-refused-as-written",
	"d-oneof-member-holding-refusal",
	"d-oneof-alike-dictionaries",
	"d-envelopes-of-refused-union",
];

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

/** Each value graded against the document's component, in both seal modes. */
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

/** Where a refusal costs what the document accepts: the validator accepts nothing the document refuses. */
function refusesWhatTheDocumentRefuses(
	name: string,
	cases: Record<string, readonly unknown[]>,
): void {
	for (const sealed of [true, false]) {
		const fixture = of(name, sealed);
		for (const [component, values] of Object.entries(cases)) {
			for (const value of values) {
				if (fixture.byDocument(component, value)) continue;
				expect(
					fixture.schemas[`${lowerFirst(component)}Schema`]?.safeParse(value).success,
					`${name} sealed=${sealed} ${component} ${JSON.stringify(value)}`,
				).toBe(false);
			}
		}
	}
}

describe("every fixture's emitted set", () => {
	it("loads and typechecks, the wire contract included, sealed and open", () => {
		for (const name of FIXTURES) {
			for (const sealed of [true, false]) {
				const { output, failed } = typecheckEmitted(of(name, sealed).compiled.outDir);
				expect(output, `${name} sealed=${sealed}`).toBe("");
				expect(failed, `${name} sealed=${sealed}`).toBe(false);
			}
		}
	});
});

describe("a property's `@oneOf` merged under a redeclaration", () => {
	it("stays a `oneOf`, refusing a value both members match", () => {
		const u = [{}, { b: "ab" }, { b: "a" }, { g: "x" }, { b: "abc", g: "a" }, { c: "green" }];
		graded("d-merged-oneof-property", {
			Leaf: u.map((each) => ({ u: each })),
			LeafUpdate: [{}, ...u.map((each) => ({ u: each }))],
		});
	});
});

describe("two merged members the validator writes alike", () => {
	it("are one member on both sides, and validate as the document publishes them", () => {
		const w = [{}, { k: {} }, { k: { a: "x" } }, { k: { a: 5 } }, 5];
		graded("d-merged-identical-members", {
			LeafV: [{}, ...w.map((each) => ({ w: each }))],
			LeafVUpdate: [{}, ...w.map((each) => ({ w: each }))],
		});
	});
});

describe("a `@oneOf` of two merged members alike", () => {
	it("is two objects on both sides, and refuses what both match", () => {
		graded("d-oneof-alike-dictionaries", {
			LeafV: [{}, { w: {} }, { w: { a: 1 } }, { v: {} }, { w: 5 }],
		});
	});
});

describe("a `@oneOf` whose member is refused", () => {
	it("validates nothing where the member is refused as it is written", () => {
		for (const sealed of [true, false]) {
			const schema = of("d-oneof-member-refused-as-written", sealed).schemas.o1CreateSchema;
			expect(schema, `sealed=${sealed}`).toBeDefined();
			for (const value of [1.5, { a: "red" }, { e: true }, {}]) {
				expect(schema?.safeParse(value).success, `sealed=${sealed} ${JSON.stringify(value)}`).toBe(
					false,
				);
			}
		}
	});

	it("accepts nothing the document refuses where a member holds a refused declaration", () => {
		refusesWhatTheDocumentRefuses("d-oneof-member-holding-refusal", {
			O3Create: [
				{ c: { b: 1, a: "a" }, e: "red" },
				{ c: { b: 1 }, e: "red" },
				{ e: "red" },
				{ b: ["x"] },
				{},
			],
		});
	});
});

describe("a union refused as `duplicate-declaration`", () => {
	it("takes its envelopes with it, which openapi3 keeps from the view written last", () => {
		for (const sealed of [true, false]) {
			const fixture = of("d-envelopes-of-refused-union", sealed);
			expect(
				fixture.compiled.program.diagnostics
					.filter((d) => d.code === "typespec-http-zod/duplicate-declaration")
					.map((d) => d.message),
				`sealed=${sealed}`,
			).toEqual([expect.stringContaining("'DU7'")]);
			for (const component of ["DU7X", "DU7Y", "DU7Z"]) {
				const schema = fixture.schemas[`${lowerFirst(component)}Schema`];
				expect(schema, `sealed=${sealed} ${component}`).toBeDefined();
				for (const value of [
					{ kind: "x", value: { e: 1.5, a: 1 } },
					{ kind: "y", value: { d: "a", b: "b" } },
					{ kind: "z", value: { b: "red" } },
					{ kind: "y" },
					{},
				]) {
					expect(
						schema?.safeParse(value).success,
						`sealed=${sealed} ${component} ${JSON.stringify(value)}`,
					).toBe(false);
				}
			}
		}
	});
});
