import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenAPI3 } from "@typespec/openapi3";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { getAllHttpServices } from "@typespec/http";
import { collectRoutes, type EmittedRoute } from "../../../src/index.js";
import { SchemaRegistry } from "../../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../../support/compile-fixture.js";
import { typecheckEmitted } from "../../support/typecheck-emitted.js";

/**
 * **Reading forms, and filling defaults, each held to the document.** A URL-encoded body and a
 * multipart part carry text, and the document describes the values that text spells: a form is
 * accepted where some reading of its text is a value of the schema openapi3 publishes for it,
 * graded here by Ajv over every reading. A default is graded by the emitted set loading and
 * typechecking, and by the diagnostic that says why one is not emitted. Every fixture is compiled
 * sealed and open.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

interface Document {
	readonly paths: Record<
		string,
		Record<
			string,
			{
				requestBody?: {
					content: Record<
						string,
						{ schema: unknown; encoding?: Record<string, { contentType?: string }> }
					>;
				};
			}
		>
	>;
	readonly components?: { readonly schemas?: Record<string, unknown> };
}

interface Loaded {
	readonly compiled: CompiledFixture;
	readonly schemas: Record<string, ZodType>;
	readonly document: Document;
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
	) as Document;
	return { compiled, schemas, document };
}

const fixtures = readdirSync(here)
	.filter((file) => file.endsWith(".tsp"))
	.map((file) => file.slice(0, -".tsp".length));

beforeAll(async () => {
	for (const name of fixtures) {
		for (const sealed of [true, false]) loaded.set(`${name}:${sealed}`, await load(name, sealed));
	}
}, 900_000);

const of = (name: string, sealed = true): Loaded => {
	const found = loaded.get(`${name}:${sealed}`);
	if (found === undefined) throw new Error(`no fixture ${name}`);
	return found;
};

/** This emitter's diagnostics, as `severity code`, sorted; the compiler's own left out. */
const ours = (name: string, sealed = true): string[] =>
	of(name, sealed)
		.compiled.program.diagnostics.filter((d) => d.code.startsWith("typespec-http-zod/"))
		.map((d) => `${d.severity} ${d.code.slice("typespec-http-zod/".length)}`)
		.toSorted();

/** The messages of this emitter's diagnostics of one code. */
const messages = (name: string, code: string): string[] =>
	of(name)
		.compiled.program.diagnostics.filter((d) => d.code === `typespec-http-zod/${code}`)
		.map((d) => d.message);

/** A validator's output for a value, or `"refused"`. */
const parsed = (name: string, exported: string, value: unknown, sealed = true): unknown => {
	const schema = of(name, sealed).schemas[exported];
	if (schema === undefined) return `no ${exported}`;
	const result = schema.safeParse(value);
	return result.success ? result.data : "refused";
};

const emitted = (name: string, file: string, sealed = true): string =>
	readFileSync(join(of(name, sealed).compiled.outDir, file), "utf8");

/** What text spells: a JSON number, a boolean, or the text itself. */
function readingsOf(text: string): unknown[] {
	const readings: unknown[] = [];
	if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) readings.push(Number(text));
	if (text === "true" || text === "false") readings.push(text === "true");
	readings.push(text);
	return readings;
}

/** Every combination of one choice from each list. */
function product<T>(lists: readonly (readonly T[])[]): T[][] {
	return lists.reduce<T[][]>(
		(combos, list) => combos.flatMap((combo) => list.map((item) => [...combo, item])),
		[[]],
	);
}

/**
 * What a multipart part's text spells under the media types the document publishes for it: the
 * JSON it is under JSON, what {@link readingsOf} reads under text, and either under both.
 */
function partReadingsOf(text: string, contentType: string): unknown[] {
	const types = contentType.split(",").map((each) => each.trim());
	const json = (each: string): boolean => /^application\/(?:[\w.+-]+\+)?json$/i.test(each);
	const readings: unknown[] = [];
	if (types.some(json)) {
		try {
			readings.push(JSON.parse(text));
		} catch {
			// No JSON, so no JSON reading.
		}
	}
	if (!types.every(json)) readings.push(...readingsOf(text));
	return readings;
}

type Wire = Readonly<Record<string, string | readonly string[]>>;

/**
 * **Every object the document can read a form as.** A key sent once is one value or the one-element
 * list it stands for; a key sent several times is the list of them; each piece of text is any value
 * it spells - under its part's media types, where `spell` says them. A field of a URL-encoded form
 * and a text part of a multipart body are read alike.
 */
function readingsOfForm(
	form: Wire,
	spell: (key: string, text: string) => unknown[] = (_, text) => readingsOf(text),
): Record<string, unknown>[] {
	const keys = Object.keys(form);
	const values = keys.map((key) => {
		const value = form[key] as string | readonly string[];
		const read = (text: string): unknown[] => spell(key, text);
		if (typeof value !== "string") return product(value.map(read)) as unknown[];
		return [...read(value), ...read(value).map((reading) => [reading])];
	});
	return product(values).map((combo) => {
		const read: Record<string, unknown> = {};
		keys.forEach((key, index) =>
			Object.defineProperty(read, key, { value: combo[index], enumerable: true }),
		);
		return read;
	});
}

/**
 * **A route's form validator held to the document**: it accepts a form exactly where some reading
 * of it is a value of the schema openapi3 publishes for the route's body under `media`.
 */
function gradedForms(
	name: string,
	path: string,
	exported: string,
	forms: readonly Wire[],
	media = "application/x-www-form-urlencoded",
	seals: readonly boolean[] = [true, false],
): void {
	for (const sealed of seals) {
		const fixture = of(name, sealed);
		const content = fixture.document.paths[path]?.post?.requestBody?.content[media];
		const schema = content?.schema;
		expect(schema, `${name} ${path} ${media}`).toBeDefined();
		const spell = (key: string, text: string): unknown[] =>
			partReadingsOf(text, content?.encoding?.[key]?.contentType ?? "text/plain");
		const validator = fixture.schemas[exported];
		expect(validator, `${name} ${exported}`).toBeDefined();
		const ajv = new Ajv2020.default({ strict: false, validateFormats: false });
		const check = ajv.compile({
			...(schema as object),
			components: fixture.document.components,
		});
		for (const form of forms) {
			const byDocument = readingsOfForm(form, spell).some((reading) => check(reading));
			expect(
				validator?.safeParse(form).success,
				`${name} sealed=${sealed} ${exported} ${JSON.stringify(form)}`,
			).toBe(byDocument);
		}
	}
}

describe("every form fixture's emitted set", () => {
	it("loads and typechecks, the wire contract included, sealed and open", () => {
		for (const name of fixtures) {
			for (const sealed of [true, false]) {
				const { output, failed } = typecheckEmitted(of(name, sealed).compiled.outDir);
				expect(output, `${name} sealed=${sealed}`).toBe("");
				expect(failed, `${name} sealed=${sealed}`).toBe(false);
			}
		}
	});
});

describe("a URL-encoded body of a union, read from the text it carries", () => {
	const name = "f1-form-unions";
	const forms: readonly Wire[] = [
		{ kind: "a", n: "5" },
		{ kind: "a", n: "x" },
		{ kind: "a", b: "true" },
		{ kind: "b", n: "5" },
		{ kind: "b", l: ["1", "2"] },
		{ kind: "b", l: "1" },
		{ kind: "b", l: ["1", "x"] },
		{ kind: "c", n: "5" },
		{ kind: "a" },
		{ kind: "d" },
		{ n: "5" },
		{},
	];

	it("reads a discriminated union with no envelope as the variant its discriminator names", () => {
		expect(parsed(name, "duBody", { kind: "a", n: "5" })).toEqual({ kind: "a", n: 5 });
		expect(parsed(name, "duBody", { kind: "b", n: "5", l: "1" })).toEqual({
			kind: "b",
			n: "5",
			l: [1],
		});
		expect(parsed(name, "dnBody", { kind: "b", l: ["1", "2"] })).toEqual({ kind: "b", l: [1, 2] });
		// Under a form or JSON, the form has its own validator and JSON keeps the document's.
		expect(parsed(name, "djFormBody", { kind: "a", b: "true" })).toEqual({ kind: "a", b: true });
		expect(parsed(name, "dUSchema", { kind: "a", b: "true" })).toBe("refused");
		for (const [path, exported] of [
			["/du", "duBody"],
			["/dn", "dnBody"],
			["/dj", "djFormBody"],
		] as const) {
			gradedForms(name, path, exported, forms);
		}
	});

	it("reads a union holding a union, or a member no form is, by the models it reaches", () => {
		expect(parsed(name, "nuBody", { kind: "b", l: "1" })).toEqual({ kind: "b", l: [1] });
		expect(parsed(name, "wsBody", { kind: "a", n: "5" })).toEqual({ kind: "a", n: 5 });
		expect(parsed(name, "wiBody", { kind: "a", n: "5" })).toEqual({ kind: "a", n: 5 });
		expect(parsed(name, "mxBody", { kind: "b", l: ["1", "2"] })).toEqual({ kind: "b", l: [1, 2] });
		for (const [path, exported] of [
			["/ws", "wsBody"],
			["/wi", "wiBody"],
			["/nu", "nuBody"],
			["/mx", "mxBody"],
			["/pc", "pcBody"],
			["/u", "uBody"],
		] as const) {
			gradedForms(name, path, exported, forms);
		}
	});

	it("reads a discriminated union's envelope, its value read as the variant the kind names", () => {
		expect(parsed(name, "deBody", { kind: "i", value: "5" })).toEqual({ kind: "i", value: 5 });
		expect(parsed(name, "deBody", { kind: "l", value: "5" })).toEqual({ kind: "l", value: [5] });
		expect(parsed(name, "deBody", { kind: "s", value: "5" })).toEqual({ kind: "s", value: "5" });
		gradedForms(name, "/de", "deBody", [
			...forms,
			{ kind: "i", value: "5" },
			{ kind: "i", value: "x" },
			{ kind: "l", value: ["1", "2"] },
			{ kind: "l", value: "5" },
			{ kind: "s", value: "5" },
			{ kind: "m", value: "5" },
		]);
	});

	it("judges each reading by the whole union, so a `@oneOf` counts as the document counts", () => {
		// `x=5` is a `PA` read as a number and a `PB` read as text: exactly one member matches each.
		expect(parsed(name, "xpBody", { x: "5" })).toEqual({ x: 5 });
		gradedForms(name, "/xp", "xpBody", [{ x: "5" }, { x: "x" }, {}, { x: ["1", "2"] }]);
		gradedForms(name, "/xo", "xoBody", forms);
	});
});

describe("a multipart part published as a list under a text media type", () => {
	const name = "f7-list-parts";
	const media = "multipart/form-data";

	it("reads a lone occurrence as the one-element list, however the part is declared", () => {
		expect(parsed(name, "fBody", { f: "5" })).toEqual({ f: [5] });
		expect(parsed(name, "fBody", { g: "5" })).toEqual({ g: [5] });
		expect(parsed(name, "fBody", { e: "x" })).toEqual({ e: ["x"] });
		expect(parsed(name, "fBody", { h: "5" })).toEqual({ h: [5] });
		expect(parsed(name, "fBody", { h: ["1", "2"] })).toEqual({ h: [1, 2] });
		expect(parsed(name, "fBody", { k: "5" })).toEqual({ k: [5] });
		gradedForms(
			name,
			"/f",
			"fBody",
			["f", "g", "e", "h", "k", "c", "j"].flatMap((key) => [
				{ [key]: "5" },
				{ [key]: "x" },
				{ [key]: "[1,2]" },
				{ [key]: ["1", "2"] },
				{ [key]: ["1", "x"] },
			]),
			media,
		);
	});

	it("reads a part that is text or JSON as JSON where the JSON is the list, and as text else", () => {
		expect(parsed(name, "fBody", { c: "5" })).toEqual({ c: [5] });
		expect(parsed(name, "fBody", { c: "[1,2]" })).toEqual({ c: [1, 2] });
		expect(parsed(name, "fBody", { c: ["1", "2"] })).toEqual({ c: [1, 2] });
		expect(parsed(name, "fBody", { c: "x" })).toBe("refused");
		// A JSON part's text is the JSON it spells, as before.
		expect(parsed(name, "fBody", { j: "[1,2]" })).toEqual({ j: [1, 2] });
	});

	it("keeps the component the document's schema, where a lone value is no list", () => {
		expect(parsed(name, "formSchema", { f: "5" })).toBe("refused");
		expect(parsed(name, "formSchema", { g: "5" })).toBe("refused");
	});
});

describe("a multipart part published as a list under JSON", () => {
	const name = "fj-json-list-parts";
	const media = "multipart/form-data";

	it("reads one text as the list's JSON or as its one element, however the part is declared", () => {
		for (const key of ["j", "r"]) {
			expect(parsed(name, "fBody", { [key]: "5" })).toEqual({ [key]: [5] });
			expect(parsed(name, "fBody", { [key]: "[1,2]" })).toEqual({ [key]: [1, 2] });
			expect(parsed(name, "fBody", { [key]: ["1", "2"] })).toEqual({ [key]: [1, 2] });
			expect(parsed(name, "fBody", { [key]: "x" })).toBe("refused");
		}
		for (const key of ["s", "t"]) {
			expect(parsed(name, "fBody", { [key]: '["a","b"]' })).toEqual({ [key]: ["a", "b"] });
			expect(parsed(name, "fBody", { [key]: '"a"' })).toEqual({ [key]: ["a"] });
			expect(parsed(name, "fBody", { [key]: "a" })).toBe("refused");
		}
		expect(parsed(name, "fBody", { u: "[1,2]" })).toEqual({ u: [1, 2] });
		expect(parsed(name, "fBody", { u: "5" })).toEqual({ u: [5] });
		const texts: Readonly<Record<string, readonly (string | readonly string[])[]>> = {
			j: ["5", "[1,2]", ["1", "2"], "x", ["1", "x"], "null", "[[1]]", "[]"],
			r: ["5", "[1,2]", ["1", "2"], "x", ["1", "x"], "null", "[[1]]", "[]"],
			s: ['"a"', '["a","b"]', ['"a"', '"b"'], "a", ["a"], "5"],
			t: ['"a"', '["a","b"]', ['"a"', '"b"'], "a", ["a"], "5"],
			n: ["null", "5", "[1]", ["1", "2"], ["null"]],
			ll: ["[1,2]", "[[1,2]]", ["[1]", "[2]"], "5", ["1"]],
			m: ['{"city":"x"}', '[{"city":"x"}]', ['{"city":"x"}', '{"city":"y"}'], '{"town":"x"}'],
			ma: ['{"city":"x"}', '[{"city":"x"}]', ['{"city":"x"}', '{"city":"y"}'], '{"town":"x"}'],
			u: ["5", "[1,2]", ["1", "2"], "x", ["1", "[2]"], '[1,"x"]'],
		};
		gradedForms(
			name,
			"/f",
			"fBody",
			Object.entries(texts).flatMap(([key, values]) => values.map((value) => ({ [key]: value }))),
			media,
		);
	});

	it("keeps the component the document's schema, where a lone value is no list", () => {
		expect(parsed(name, "formSchema", { j: "5" })).toBe("refused");
		expect(parsed(name, "formSchema", { r: "5" })).toBe("refused");
		expect(parsed(name, "formSchema", { r: "[1,2]" })).toEqual({ r: [1, 2] });
	});
});

describe("a text part of a union holding a list", () => {
	const name = "fu-text-union-lists";

	// Nothing is boxed for the request, so the route validates with the component itself.
	it("reads one value, or several sent as as many parts, as a form's field is read", () => {
		expect(parsed(name, "formSchema", { g: "5" })).toEqual({ g: 5 });
		expect(parsed(name, "formSchema", { g: ["1", "2"] })).toEqual({ g: [1, 2] });
		expect(parsed(name, "formSchema", { k: "a" })).toEqual({ k: ["a"] });
		expect(parsed(name, "formSchema", { l: ["1", "x"] })).toEqual({ l: ["1", "x"] });
		expect(parsed(name, "formSchema", { h: ["1", "2"] })).toEqual({ h: [1, 2] });
		gradedForms(
			name,
			"/f",
			"formSchema",
			["g", "l", "n", "h", "k"].flatMap((key) => [
				{ [key]: "5" },
				{ [key]: "x" },
				{ [key]: "1,2" },
				{ [key]: "[1,2]" },
				{ [key]: ["1", "2"] },
				{ [key]: ["1", "x"] },
				{ [key]: ["x"] },
			]),
			"multipart/form-data",
		);
	});
});

describe("a `@oneOf` sent as a URL-encoded form", () => {
	it("is refused where a member reads one text two ways another member tells apart", () => {
		for (const sealed of [true, false]) {
			expect(ours("fo-oneof-ambiguous", sealed)).toEqual([
				"error ambiguous-form-reading",
				"error ambiguous-form-reading",
				"error ambiguous-form-reading",
				"error ambiguous-form-reading",
			]);
		}
		expect(messages("fo-oneof-ambiguous", "ambiguous-form-reading")).toEqual([
			expect.stringContaining("'AmbiguousOneOfForms.KM' may read the text of 'x' as the number"),
			expect.stringContaining(
				"'u' accepts the '@oneOf' 'AmbiguousOneOfForms.U' as a URL-encoded form, where 'AmbiguousOneOfForms.M' may read the text of 'x' as the number it spells and as itself, and 'AmbiguousOneOfForms.N' accepts only the first.",
			),
			expect.stringContaining("'AmbiguousOneOfForms.L' may read the text of 'x' as the number"),
			expect.stringContaining("'AmbiguousOneOfForms.R' may read the text of 'x' as the number"),
		]);
		expect(parsed("fo-oneof-ambiguous", "uBody", { x: "5" })).toBe("refused");
	});

	it("is refused open where an open member accepts every reading of a key another declares", () => {
		const said = of("fo-oneof-distinct", false).compiled.program.diagnostics.map((d) => d.message);
		expect(said).toEqual([
			expect.stringContaining("'w' accepts the '@oneOf' 'DistinctOneOfForms.W'"),
		]);
	});

	it("reads one whose readings no member tells apart as the document does", () => {
		const name = "fo-oneof-distinct";
		expect(ours(name)).toEqual([]);
		expect(parsed(name, "vBody", { x: "5" })).toEqual({ x: 5 });
		expect(parsed(name, "vBody", { x: "a" })).toEqual({ x: "a" });
		const forms: readonly Wire[] = [
			{ x: "5" },
			{ x: "a" },
			{ x: "all" },
			{ y: "true" },
			{ y: "x" },
			{ x: "5", y: "true" },
			{ x: ["1", "2"] },
			{ kind: "m", x: "5" },
			{ kind: "m", x: "a" },
			{ kind: "n", x: "5" },
			{ kind: "n", x: "a" },
			{ a: "5", b: "x" },
			{ a: "x", b: "x" },
			{ a: "5" },
			{ b: "x" },
			{},
		];
		for (const [path, exported] of [
			["/r", "rBody"],
			["/v", "vBody"],
			["/w", "wBody"],
			["/d", "dBody"],
			["/a", "aBody"],
		] as const) {
			gradedForms(name, path, exported, forms, undefined, path === "/w" ? [true] : undefined);
		}
	});
});

describe("a multipart part a client may send with a filename", () => {
	const routeOf = (name: string, operationId: string): EmittedRoute => {
		const { program } = of(name).compiled;
		const [[service]] = getAllHttpServices(program);
		if (service === undefined) throw new Error("no service");
		const found = collectRoutes(program, new SchemaRegistry(program), service).find(
			(route) => route.operationId === operationId,
		);
		if (found === undefined) throw new Error(`no route ${operationId}`);
		return found;
	};

	it("is named for the server to read as text, JSON alone marked, a file and raw bytes left out", () => {
		expect(routeOf("fp-text-parts", "f").textParts).toEqual([
			{ name: "json", json: true },
			{ name: "list", json: true },
			{ name: "text", json: false },
			{ name: "number", json: false },
			{ name: "either", json: false },
			{ name: "repeated", json: true },
		]);
	});

	it("is named on no body that is not multipart", () => {
		expect(routeOf("fo-oneof-distinct", "v").textParts).toBeUndefined();
	});
});

describe("a default the validator's type cannot spell as a literal", () => {
	const name = "f2-indexer-default";

	it("fills a default setting a declared key beside an indexer that refuses its type", () => {
		expect(parsed(name, "bSchema", {})).toEqual({
			r: { s: "x" },
			r2: { n: 1 },
			l: [{ s: "y", k: 2 }],
			w: { o: { s: "z" } },
			plain: { k: 1 },
		});
		expect(parsed(name, "hHeader", {})).toEqual({ x: { k: 1, s: "x" } });
		expect(ours(name)).toEqual([]);
	});

	it("writes a literal where the literal is a value of the type", () => {
		expect(emitted(name, "schemas.gen.ts")).toContain('objIdxSchema.default({"k": 1})');
	});
});

describe("a default a literal declared above refuses", () => {
	const name = "fc-merged-literal-default";

	it("is not emitted, and `invalid-default` says why", () => {
		for (const sealed of [true, false]) {
			expect(ours(name, sealed)).toEqual([
				"warning default-on-required-property",
				"warning invalid-default",
				"warning invalid-default",
				"warning invalid-default",
			]);
		}
		const said = messages(name, "invalid-default");
		expect(said.some((message) => message.includes("'a'") && message.includes('"red"'))).toBe(true);
		expect(said.some((message) => message.includes("'kk'") && message.includes('"b"'))).toBe(true);
		expect(said.some((message) => message.includes('"red" or "green"'))).toBe(true);
		// Required above, the default never applies, and that is what is reported for it.
		expect(messages(name, "default-on-required-property")).toEqual([
			expect.stringContaining("required by a declaration of its key above it"),
		]);
	});

	it("validates what the document accepts, and fills a default the literal above holds", () => {
		expect(parsed(name, "subSchema", { k: {} })).toEqual({ k: {} });
		expect(parsed(name, "subSchema", { k: { a: "red" } })).toEqual({ k: { a: "red" } });
		expect(parsed(name, "subSchema", { k: { a: "a" } })).toBe("refused");
		expect(parsed(name, "leafSchema", {})).toEqual({});
		expect(parsed(name, "leafSchema", { k: "abcd" })).toBe("refused");
		expect(parsed(name, "leafESchema", {})).toEqual({});
		expect(parsed(name, "leafOkSchema", {})).toEqual({ k: "red" });
	});
});
