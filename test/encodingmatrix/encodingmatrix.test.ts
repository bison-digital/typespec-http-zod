import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A property or parameter under `@encode` validates what the document publishes for it, for every
 * kind of declared type in every location.** See `encodingmatrix.tsp`.
 *
 * openapi3 keeps the declared type's schema and replaces only its `type`, so `@encode("x", string)
 * color: Color` is `{ $ref: Color, type: "string" }`: a string, and one of Color's values. This
 * emitter replaced the type outright and validated `z.string()`, accepting `"green"`; it dropped a
 * named scalar's `@pattern`, a literal union's values, and the `null` of a nullable property.
 *
 * **Every verdict is graded by Ajv against the document**, in the body and as a query, header, path
 * and cookie parameter. Each body row starts from a valid value for every key and changes one, so a
 * refusal is that row's alone; a parameter is graded as the value it decodes to, against the
 * parameter's own schema.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let documentOf: {
	components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
	paths: Record<string, { get?: Parameters; post?: Parameters }>;
};
interface Parameters {
	readonly parameters?: readonly { name: string; in: string; schema: unknown }[];
}
const ajv = new Ajv2020.default({ strict: false, validateFormats: false });

beforeAll(async () => {
	compiled = await compileFixture(here, "encodingmatrix", { outName: "encodingmatrix" });
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	const [record] = await getOpenAPI3(compiled.program, {
		"openapi-versions": ["3.1.0"],
		// As the fixture was compiled: an unsealed document graded against a sealed validator
		// hides any disagreement about which properties may exist.
		"seal-object-schemas": true,
	});
	documentOf = JSON.parse(
		JSON.stringify(record !== undefined && !record.versioned ? record.document : {}),
	) as typeof documentOf;
}, 300_000);

const byDocument = (schema: unknown, value: unknown): boolean =>
	ajv.validate({ ...(schema as object), components: documentOf.components }, value);

type Location = "query" | "header" | "path" | "cookie";
const LOCATIONS: readonly Location[] = ["query", "header", "path", "cookie"];

interface Kind {
	readonly name: string;
	/** A body value the document accepts, beside which each of `body` is tried. */
	readonly valid: unknown;
	readonly body: readonly unknown[];
	/** Wire values for a parameter; the first is valid wherever the kind is declared. */
	readonly wire: readonly string[];
	/** The value a wire string decodes to, where it is not the string itself. */
	readonly decode?: (wire: string, location: Location) => unknown;
}

const integer = (wire: string): unknown => (/^-?\d+$/.test(wire) ? Number(wire) : wire);

/** The rows `encodingmatrix.tsp` is generated from, one per kind of declared type. */
const KINDS: readonly Kind[] = [
	{ name: "int", valid: "5", body: ["5", "abc", 5], wire: ["5", "abc"] },
	{ name: "word", valid: "abc", body: ["abc", "ABC"], wire: ["abc", "ABC"] },
	{ name: "color", valid: "red", body: ["red", "green"], wire: ["red", "green"] },
	{ name: "pick", valid: "a", body: ["a", "c"], wire: ["a", "c"] },
	{ name: "inline", valid: "a", body: ["a", "c"], wire: ["a", "c"] },
	{ name: "litsnull", valid: "a", body: ["a", null, "c"], wire: ["a", "c"] },
	{ name: "colornull", valid: "red", body: ["red", null, "green"], wire: ["red", "green"] },
	{ name: "intnull", valid: "5", body: ["5", null, 5], wire: ["5", "abc"] },
	{
		name: "list",
		valid: "1,2",
		body: ["1,2", [1, 2]],
		wire: ["1,2", "1,x"],
		// A query parameter's array encoding is a style, so the value is the list; elsewhere it is text.
		decode: (wire, location) =>
			location === "query" ? wire.split(",").map((item) => integer(item)) : wire,
	},
	{ name: "rec", valid: "a,1", body: ["a,1", { a: 1 }], wire: ["a,1"] },
	{ name: "at", valid: 5, body: [5, "5"], wire: ["5", "x"], decode: integer },
	{ name: "mixed", valid: "x", body: ["x", 5], wire: ["x"] },
	{ name: "modelor", valid: "x", body: ["x", 5, { a: 1 }], wire: ["x"] },
	{ name: "spread", valid: "x", body: ["x", 5, { a: 1 }], wire: ["x"] },
	{
		name: "httpdate",
		valid: "Wed, 21 Oct 2015 07:28:00 GMT",
		body: ["Wed, 21 Oct 2015 07:28:00 GMT", 5],
		wire: ["Wed, 21 Oct 2015 07:28:00 GMT"],
	},
	{
		name: "derived",
		valid: 5,
		body: [5, "2020-01-01T00:00:00Z"],
		wire: ["5", "2020-01-01T00:00:00Z"],
		decode: integer,
	},
	{
		name: "floatint",
		valid: 1,
		body: [1, 1.5, "1"],
		wire: ["1", "1.5"],
		decode: (wire) => (Number.isNaN(Number(wire)) ? wire : Number(wire)),
	},
];

const decoded = (kind: Kind, wire: string, location: Location): unknown =>
	kind.decode === undefined ? wire : kind.decode(wire, location);

describe("the fixture", () => {
	it("compiles without a diagnostic", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	it("declares every kind in the body and in every parameter location", () => {
		const names = KINDS.map((kind) => kind.name).toSorted();
		expect(Object.keys(documentOf.components.schemas["Body"]?.properties ?? {}).toSorted()).toEqual(
			names,
		);
		for (const location of LOCATIONS) {
			const parameters = parametersOf(location);
			expect(
				parameters.filter((parameter) => parameter.in === location).map((p) => p.name),
			).toEqual(KINDS.map((kind) => kind.name));
		}
	});
});

describe("a body property under @encode", () => {
	const body = (): Record<string, unknown> =>
		Object.fromEntries(KINDS.map((kind) => [kind.name, kind.valid]));

	for (const kind of KINDS) {
		it(`${kind.name}: answers ${kind.body.map((v) => JSON.stringify(v)).join(", ")} as the document does`, () => {
			const verdicts = kind.body.map((value) => {
				const candidate = { ...body(), [kind.name]: value };
				const validator = schemas["bodySchema"]?.safeParse(candidate).success;
				const document = byDocument({ $ref: "#/components/schemas/Body" }, candidate);
				expect(validator, `${kind.name} = ${JSON.stringify(value)}`).toBe(document);
				return document;
			});
			// Not vacuous: each row has a value the document accepts and one it refuses.
			expect(verdicts).toContain(true);
			expect(verdicts).toContain(false);
		});
	}
});

function parametersOf(
	location: Location,
): readonly { name: string; in: string; schema: unknown }[] {
	const path =
		location === "path"
			? Object.keys(documentOf.paths).find((key) => key.startsWith("/path/"))
			: `/${location}`;
	return documentOf.paths[path ?? ""]?.get?.parameters ?? [];
}

describe("a parameter under @encode", () => {
	for (const location of LOCATIONS) {
		const verdicts: boolean[] = [];
		for (const kind of KINDS) {
			it(`${location} ${kind.name}: answers ${kind.wire.map((v) => JSON.stringify(v)).join(", ")} as the document does`, () => {
				const parameters = parametersOf(location);
				const wires = Object.fromEntries(KINDS.map((each) => [each.name, each.wire[0] as string]));
				for (const wire of kind.wire) {
					const validator = schemas[
						`${location}${location[0]?.toUpperCase()}${location.slice(1)}`
					]?.safeParse({
						...wires,
						[kind.name]: wire,
					}).success;
					const document = parameters.every((parameter) => {
						const each = KINDS.find((candidate) => candidate.name === parameter.name);
						if (each === undefined) return true;
						const sent = parameter.name === kind.name ? wire : (each.wire[0] as string);
						return byDocument(parameter.schema, decoded(each, sent, location));
					});
					expect(validator, `${kind.name} = ${JSON.stringify(wire)}`).toBe(document);
					verdicts.push(document);
				}
			});
		}
		it(`${location}: grades a value the document refuses as well as ones it accepts`, () => {
			expect(verdicts).toContain(true);
			expect(verdicts).toContain(false);
		});
	}
});

describe("the contract type of a property under @encode", () => {
	it("is what the validator accepts, and the emitted set compiles", () => {
		const file = join(compiled.outDir, "consumer.ts");
		writeFileSync(
			file,
			`import type { WireInputs } from "./requests.gen.js";

type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;
type Body = WireInputs["body"];
export type Int = MustHold<Identical<Body["int"], string>>;
export type Word = MustHold<Identical<Body["word"], string>>;
export type Color = MustHold<Identical<Body["color"], "red" | "blue">>;
export type Pick = MustHold<Identical<Body["pick"], "a" | "b">>;
export type Inline = MustHold<Identical<Body["inline"], "a" | "b">>;
export type LitsNull = MustHold<Identical<Body["litsnull"], "a" | "b" | null>>;
export type ColorNull = MustHold<Identical<Body["colornull"], "red" | "blue" | null>>;
export type IntNull = MustHold<Identical<Body["intnull"], string | null>>;
export type List = MustHold<Identical<Body["list"], string>>;
export type Rec = MustHold<Identical<Body["rec"], string>>;
export type At = MustHold<Identical<Body["at"], number>>;
export type Mixed = MustHold<Identical<Body["mixed"], string>>;
export type ModelOr = MustHold<Identical<Body["modelor"], string>>;
export type Spread = MustHold<Identical<Body["spread"], string>>;
export type HttpDate = MustHold<Identical<Body["httpdate"], string>>;
export type Derived = MustHold<Identical<Body["derived"], number>>;
export type FloatInt = MustHold<Identical<Body["floatint"], number>>;
export type QueryColor = MustHold<Identical<WireInputs["query"]["color"], "red" | "blue">>;
`,
		);
		try {
			// `wire-contract.gen.ts` asserts every contract type identical to `z.input` of its validator.
			const { output, failed } = typecheckEmitted(compiled.outDir);
			expect(output).toBe("");
			expect(failed).toBe(false);
		} finally {
			rmSync(file, { force: true });
		}
	});
});
