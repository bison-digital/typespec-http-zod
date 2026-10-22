import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type EmitContext,
	getNamespaceFullName,
	type Model,
	type Program,
	type Type,
} from "@typespec/compiler";
import { createMetadataInfo, Visibility } from "@typespec/http";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { emitHttpZod, type EmittedService } from "../../src/index.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **`EmittedService.typeSchemaNames`, graded against the module it names.** A wrapping emitter imports
 * a declared type's validator by the identifier this publishes, so each entry is held to an export of
 * `schemas.gen.ts`, to the declaration under the type's own component name rather than a view of it,
 * and to the type objects a walk from `EmittedService.operations` reaches - see `typeschemanames.tsp`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

/** Timings are reported nowhere: the records are what this suite reads. */
const perf: EmitContext["perf"] = {
	startTimer: () => ({ end: () => 0 }),
	time: (_label, callback) => callback(),
	timeAsync: (_label, callback) => callback(),
	report: () => {},
};

/**
 * The fixture emitted again from its own program and options, so the records describe the files the
 * suite loads: the second emission rewrites them, and has to rewrite them unchanged.
 */
async function emittedOf(compiled: CompiledFixture): Promise<EmittedService> {
	// As the compile handed them to this emitter: an emitter reads its options untyped.
	const options = (compiled.program.compilerOptions.options?.["typespec-http-zod"] ??
		{}) as EmitContext["options"];
	const schemasFile = join(compiled.outDir, "schemas.gen.ts");
	const before = readFileSync(schemasFile, "utf8");
	const [only] = await emitHttpZod({
		program: compiled.program,
		emitterOutputDir: compiled.outDir,
		options,
		perf,
	});
	if (only === undefined) throw new Error("the fixture declares a service");
	expect(readFileSync(schemasFile, "utf8")).toBe(before);
	return only;
}

/** `TypeSchemaNames.Dog`, or `RefusedNames.Alpha.Thing`: a declared type by its full name. */
function fullNameOf(type: Type): string {
	const named = type as { name?: unknown; namespace?: Parameters<typeof getNamespaceFullName>[0] };
	const name = typeof named.name === "string" ? named.name : `<${type.kind}>`;
	return named.namespace === undefined ? name : `${getNamespaceFullName(named.namespace)}.${name}`;
}

/** Every entry, by the type's full name, in a stable order. */
function entriesOf(service: EmittedService): [string, string][] {
	return [...service.typeSchemaNames]
		.map(([type, identifier]): [string, string] => [fullNameOf(type), identifier])
		.toSorted(([a], [b]) => a.localeCompare(b));
}

/** A response body's own type, which can be a copy of the model it is: see `responseModelsOf`. */
function bodyTypesOf(service: EmittedService): Type[] {
	return [...service.operations.values()].flatMap((operation) =>
		operation.responses.flatMap((response) =>
			response.responses.flatMap((content) =>
				content.body === undefined ? [] : [content.body.type],
			),
		),
	);
}

/**
 * Every model a response body reaches, and each subtype of each one, nested bases included: the walk
 * a wrapping emitter resolving a discriminated base makes, from the operations it was handed.
 *
 * **Each body is resolved to its effective payload type first, as openapi3 resolves it.**
 * `@typespec/http` hands a response body over as a copy where visibility reshapes the model - `Widget`
 * returned beside a create-only property is `{ ...Widget }` - and a copy has no `derivedModels`, so a
 * walk that started from it would never reach a subtype.
 */
function responseModelsOf(program: Program, service: EmittedService): Model[] {
	const metadata = createMetadataInfo(program, { canonicalVisibility: Visibility.Read });
	const found = new Set<Model>();
	const visit = (type: Type): void => {
		if (type.kind !== "Model" || found.has(type)) return;
		found.add(type);
		for (const derived of type.derivedModels) visit(derived);
	};
	for (const body of bodyTypesOf(service)) {
		visit(metadata.getEffectivePayloadType(body, Visibility.Read));
	}
	return [...found];
}

/** Every entry the fixture's module has, by the type's full name. */
const ENTRIES: readonly (readonly [string, string])[] = [
	["TypeSchemaNames.Color", "colorSchema"],
	["TypeSchemaNames.default", "default_Schema"],
	["TypeSchemaNames.Dog", "dogSchema"],
	["TypeSchemaNames.DogKind", "dogKindSchema"],
	["TypeSchemaNames.Fish", "fishSchema"],
	["TypeSchemaNames.Gadget", "gadgetSchema"],
	["TypeSchemaNames.Golden", "goldenSchema"],
	["TypeSchemaNames.Hound", "canineSchema"],
	["TypeSchemaNames.Left.Pair", "pairSchema"],
	["TypeSchemaNames.Orphan", "orphanSchema"],
	["TypeSchemaNames.Pairs", "pairsSchema"],
	["TypeSchemaNames.Pet", "petSchema"],
	["TypeSchemaNames.Puppy", "puppySchema"],
	["TypeSchemaNames.Right.Pair", "pairSchema"],
	["TypeSchemaNames.Salmon", "salmonSchema"],
	["TypeSchemaNames.SawShark", "sawSharkSchema"],
	["TypeSchemaNames.Shark", "sharkSchema"],
	["TypeSchemaNames.Upload", "uploadSchema"],
	["TypeSchemaNames.Widget", "widgetSchema"],
];

describe("each declared type's validator, by the type", () => {
	let compiled: CompiledFixture;
	let service: EmittedService;
	let schemas: Record<string, ZodType>;

	beforeAll(async () => {
		compiled = await compileFixture(here, "typeschemanames");
		service = await emittedOf(compiled);
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	}, 120_000);

	it("compiles clean", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	it("names every declared type under its own component name, renamed as the module renames it", () => {
		expect(entriesOf(service)).toEqual(ENTRIES);
	});

	it("names an export of schemas.gen.ts for every entry, and none that validates nothing", () => {
		for (const identifier of service.typeSchemaNames.values()) {
			const schema = schemas[identifier];
			expect(typeof schema?.safeParse, identifier).toBe("function");
			expect(schema?._zod.def.type, identifier).not.toBe("never");
		}
	});

	it("names the response's reading of a type with a create view, not the view", () => {
		const [widget] = compiled.program.resolveTypeReference("TypeSchemaNames.Widget");
		expect(widget).toBeDefined();
		expect(service.typeSchemaNames.get(widget as Type)).toBe("widgetSchema");
		expect([...service.typeSchemaNames.values()]).not.toContain("widgetCreateSchema");
		// The view is declared beside it, and answers as a create body does: `secret`, and no `id`.
		const created = { secret: "s", name: "w", color: "red" };
		const returned = { id: "1", name: "w", color: "red" };
		expect(schemas.widgetCreateSchema?.safeParse(created).success).toBe(true);
		expect(schemas.widgetCreateSchema?.safeParse(returned).success).toBe(false);
		expect(schemas.widgetSchema?.safeParse(returned).success).toBe(true);
		expect(schemas.widgetSchema?.safeParse(created).success).toBe(false);
	});

	it("has no entry for a type published only as views of it", () => {
		const [draft] = compiled.program.resolveTypeReference("TypeSchemaNames.Draft");
		expect(draft).toBeDefined();
		expect(service.typeSchemaNames.has(draft as Type)).toBe(false);
		// The module declares the views, and nothing under the type's own name.
		expect(
			Object.keys(schemas)
				.filter((name) => name.startsWith("draft"))
				.toSorted(),
		).toEqual(["draftCreateOrUpdateSchema", "draftCreateSchema"]);
	});

	it("is a type's own declaration for each type of a name two types render alike", () => {
		const pairs = ["Left", "Right"].map(
			(side) => compiled.program.resolveTypeReference(`TypeSchemaNames.${side}.Pair`)[0],
		);
		expect(pairs[0]).not.toBe(pairs[1]);
		for (const pair of pairs) expect(service.typeSchemaNames.get(pair as Type)).toBe("pairSchema");
	});

	it("keys every model a response reaches, and every subtype of each, by the types the operations hold", () => {
		const reached = responseModelsOf(compiled.program, service).map(fullNameOf).toSorted();
		expect(reached).toEqual(
			[
				"TypeSchemaNames.default",
				"TypeSchemaNames.Dog",
				"TypeSchemaNames.Fish",
				"TypeSchemaNames.Gadget",
				"TypeSchemaNames.Golden",
				"TypeSchemaNames.Hound",
				"TypeSchemaNames.Pairs",
				"TypeSchemaNames.Pet",
				"TypeSchemaNames.Puppy",
				"TypeSchemaNames.Salmon",
				"TypeSchemaNames.SawShark",
				"TypeSchemaNames.Shark",
				"TypeSchemaNames.Widget",
			].toSorted(),
		);
		for (const model of responseModelsOf(compiled.program, service)) {
			expect(service.typeSchemaNames.has(model), fullNameOf(model)).toBe(true);
		}
	});

	it("keys a body by the model it is, not the copy @typespec/http hands over", () => {
		// `getWidget` and `createWidget` each return `{ ...Widget }`.
		const copies = bodyTypesOf(service).filter((type) => type.kind === "Model" && type.name === "");
		expect(copies).toHaveLength(2);
		const metadata = createMetadataInfo(compiled.program, { canonicalVisibility: Visibility.Read });
		for (const copy of copies) {
			expect(service.typeSchemaNames.has(copy)).toBe(false);
			const model = metadata.getEffectivePayloadType(copy, Visibility.Read);
			expect(service.typeSchemaNames.get(model)).toBe("widgetSchema");
		}
	});

	/**
	 * **What the map is for: choosing a subtype exactly where its own validator accepts.** The base's
	 * parsed output does not say which arm of its dispatch matched, and no shape check can stand in
	 * for the subtype's validator - `Puppy` differs from `Pet` only by `@maxValue(1)`.
	 */
	it("tells a subtype from its base by the subtype's validator, at every level of a nested base", () => {
		const resolve = (base: string, value: unknown, ...subtypes: string[]): string => {
			const validator = (name: string): ZodType => {
				const [type] = compiled.program.resolveTypeReference(`TypeSchemaNames.${name}`);
				const identifier = service.typeSchemaNames.get(type as Type);
				expect(identifier, name).toBeDefined();
				return schemas[identifier as string] as ZodType;
			};
			expect(validator(base).safeParse(value).success, base).toBe(true);
			return subtypes.findLast((each) => validator(each).safeParse(value).success) ?? base;
		};
		expect(resolve("Dog", { kind: "golden", weight: 8 }, "Golden")).toBe("Dog");
		expect(resolve("Dog", { kind: "golden", weight: 8, coat: "red" }, "Golden")).toBe("Golden");
		expect(resolve("Pet", { kind: "puppy", age: 5 }, "Puppy")).toBe("Pet");
		expect(resolve("Pet", { kind: "puppy", age: 1 }, "Puppy")).toBe("Puppy");
		const saw = { kind: "shark", sharktype: "saw", age: 3 };
		expect(resolve("Fish", saw, "Shark", "SawShark")).toBe("Shark");
		expect(resolve("Fish", { ...saw, teeth: 40 }, "Shark", "SawShark")).toBe("SawShark");
		expect(resolve("Fish", { kind: "salmon", age: 2 }, "Salmon", "Shark")).toBe("Salmon");
	});
});

describe("under the options that reshape the module and not its names", () => {
	/**
	 * `compile-schemas` wraps each validator in `z.compile()` and `seal-object-schemas` changes what an
	 * object admits; neither renames a declaration, so each names what the default does, and each
	 * entry is still an export that validates something.
	 */
	const graded = async (compiled: CompiledFixture): Promise<void> => {
		expect(compiled.diagnostics).toEqual([]);
		const service = await emittedOf(compiled);
		expect(entriesOf(service)).toEqual(ENTRIES);
		const schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
			string,
			ZodType
		>;
		for (const identifier of service.typeSchemaNames.values()) {
			expect(typeof schemas[identifier]?.safeParse, identifier).toBe("function");
			expect(schemas[identifier]?._zod.def.type, identifier).not.toBe("never");
		}
	};

	it("compile-schemas", async () => {
		await graded(
			await compileFixture(here, "typeschemanames", {
				outName: "typeschemanames-compiled",
				extraOptions: { "compile-schemas": true },
			}),
		);
	}, 120_000);

	it("seal-object-schemas off", async () => {
		await graded(
			await compileFixture(here, "typeschemanames", {
				outName: "typeschemanames-unsealed",
				extraOptions: { "seal-object-schemas": false },
			}),
		);
	}, 120_000);
});

describe("at OpenAPI 3.0, openapi3's default", () => {
	let compiled: CompiledFixture;
	let service: EmittedService;
	let schemas: Record<string, ZodType>;

	beforeAll(async () => {
		compiled = await compileFixture(here, "typeschemanames", {
			openapiVersions: null,
			outName: "typeschemanames-30",
		});
		service = await emittedOf(compiled);
		schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	}, 120_000);

	it("compiles clean", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	it("names the response's reading of a shared schema, not the reading a request is given", () => {
		const [gadget] = compiled.program.resolveTypeReference("TypeSchemaNames.Gadget");
		expect(gadget).toBeDefined();
		expect(service.typeSchemaNames.get(gadget as Type)).toBe("gadgetSchema");
		expect([...service.typeSchemaNames.values()]).not.toContain("gadgetCreateSchema");
		// A 3.0 request may leave the required read-only `id` out; a response may not.
		expect(schemas.gadgetCreateSchema?.safeParse({ name: "g" }).success).toBe(true);
		expect(schemas.gadgetSchema?.safeParse({ name: "g" }).success).toBe(false);
	});
});

describe("a versioned service", () => {
	let compiled: CompiledFixture;
	let service: EmittedService;

	beforeAll(async () => {
		compiled = await compileFixture(here, "versioned");
		service = await emittedOf(compiled);
	}, 120_000);

	it("compiles clean", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	it("is keyed by the types projected to its latest version, which the operations hold", () => {
		const reached = responseModelsOf(compiled.program, service);
		expect(reached.map(fullNameOf).toSorted()).toEqual([
			"VersionedNames.Fish",
			"VersionedNames.Salmon",
		]);
		for (const model of reached) {
			expect(service.typeSchemaNames.has(model), fullNameOf(model)).toBe(true);
		}
		expect(entriesOf(service)).toEqual([
			["VersionedNames.Fish", "fishSchema"],
			["VersionedNames.Salmon", "salmonSchema"],
			["VersionedNames.Versions", "versionsSchema"],
		]);
		// And not by the types as declared, which hold every version at once.
		const [declared] = compiled.program.resolveTypeReference("VersionedNames.Fish");
		expect(declared).toBeDefined();
		expect(reached).not.toContain(declared);
		expect(service.typeSchemaNames.has(declared as Type)).toBe(false);
	});
});

describe("a declaration refused whole", () => {
	let compiled: CompiledFixture;
	let service: EmittedService;
	let source: string;

	beforeAll(async () => {
		compiled = await compileFixture(here, "refused");
		service = await emittedOf(compiled);
		source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
	}, 120_000);

	it("has no entry, while each model holding one, a declaration of its own, does", () => {
		expect(compiled.diagnostics.map((d) => d.code).toSorted()).toEqual([
			"typespec-http-zod/duplicate-declaration",
			"typespec-http-zod/split-visibility",
		]);
		// The module declares each name, and it validates nothing: described, where it has a doc.
		expect(source).toMatch(/^export const thingSchema = z\.never\(\);$/m);
		expect(source).toMatch(/^export const innerSchema = z\.never\(\)\.describe\(/m);
		expect(entriesOf(service)).toEqual([
			["RefusedNames.Kept", "keptSchema"],
			["RefusedNames.Outer", "outerSchema"],
		]);
	});

	it("names a holder's validator, which refuses only a value carrying the refused type", async () => {
		const schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
			string,
			ZodType
		>;
		expect(schemas.keptSchema?.safeParse({ note: "n" }).success).toBe(true);
		expect(schemas.keptSchema?.safeParse({ note: "n", alpha: { a: "x" } }).success).toBe(false);
	});
});
