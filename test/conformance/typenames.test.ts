import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type EmitContext,
	getNamespaceFullName,
	navigateProgram,
	type Program,
	type Type,
} from "@typespec/compiler";
import { createMetadataInfo, getVisibilitySuffix, Visibility } from "@typespec/http";
import { getOpenAPITypeName } from "@typespec/openapi";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { emitHttpZod, type EmittedService } from "../../src/index.js";
import {
	compileScenario,
	depthSources,
	discoverScenarios,
	GRADED_OPENAPI_VERSIONS,
	openapiDirFor,
} from "./corpus.js";

/**
 * **`EmittedService.typeSchemaNames` over the whole corpus, graded against the document and the
 * module.** Each entry has to name the component openapi3 publishes for its type, under the identifier
 * the module exports for that component, and to validate something. And every type a response reaches
 * that the document publishes a validated component for has to have its entry.
 *
 * **The component's name is openapi3's, asked of `getOpenAPITypeName` as its schema emitter asks it**,
 * never of this package's naming, so an entry pointing at the wrong declaration names a component the
 * type does not have. The views openapi3 publishes beside a component are told apart by its own suffix
 * rule, `getVisibilitySuffix` against `Read`, applied to the names of the types reached.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const outRoot = join(here, ".out-typenames");

/** Timings are reported nowhere: the records are what this suite reads. */
const perf: EmitContext["perf"] = {
	startTimer: () => ({ end: () => 0 }),
	time: (_label, callback) => callback(),
	timeAsync: (_label, callback) => callback(),
	report: () => {},
};

/** openapi3's component name for a type: its schema emitter's `#typeNameOptions`, verbatim. */
function componentNameOf(program: Program, type: Type, service: EmittedService): string {
	const serviceNamespaceName = getNamespaceFullName(service.service.namespace);
	return getOpenAPITypeName(program, type, {
		namespaceFilter: (namespace) => getNamespaceFullName(namespace) !== serviceNamespaceName,
	});
}

/**
 * The identifiers the module may export a component's validator under: its last segment, lowered,
 * with `Schema` - or with `_Schema`, where the module renames a name it cannot declare, and then only
 * where it declares nothing under the plain one.
 */
function identifiersFor(component: string): readonly [string, string] {
	const bare = (component.split(".").at(-1) ?? component).replace(/[^A-Za-z0-9_]/g, "_");
	const lowered = `${bare.charAt(0).toLowerCase()}${bare.slice(1)}`;
	return [`${lowered}Schema`, `${lowered}_Schema`];
}

function isValidator(value: unknown): value is ZodType {
	return typeof (value as ZodType | undefined)?.safeParse === "function";
}

/**
 * Whether openapi3 names this component as a view of a type's own: the type's name, then the suffix
 * it gives a visibility other than `Read`, or the one it gives a multipart body.
 */
function isViewOf(component: string, own: ReadonlySet<string>): boolean {
	for (const suffix of VIEW_SUFFIXES) {
		if (component.endsWith(suffix) && own.has(component.slice(0, -suffix.length))) return true;
	}
	return false;
}

/** Every visibility openapi3 can suffix a view with: each lifecycle set, alone and with each modifier. */
const VIEW_VISIBILITIES: readonly Visibility[] = (() => {
	const lifecycle = [
		Visibility.Read,
		Visibility.Create,
		Visibility.Update,
		Visibility.Delete,
		Visibility.Query,
	];
	const found: Visibility[] = [];
	for (let mask = 1; mask < 1 << lifecycle.length; mask += 1) {
		const set = lifecycle.reduce<Visibility>(
			(each, flag, index) => ((mask & (1 << index)) !== 0 ? each | flag : each),
			Visibility.None,
		);
		for (const modifier of [Visibility.None, Visibility.Item, Visibility.Patch]) {
			found.push(set | modifier);
		}
	}
	return found;
})();

const VIEW_SUFFIXES: readonly string[] = [
	...new Set([
		...VIEW_VISIBILITIES.map((at) => getVisibilitySuffix(at, Visibility.Read)),
		"MultiPart",
	]),
].filter((suffix) => suffix !== "");

/**
 * Every model, union and enum a response reaches: each body resolved to its effective payload type as
 * openapi3 resolves it, then through properties, bases, subtypes, variants and list elements.
 */
function responseTypesOf(program: Program, service: EmittedService): Set<Type> {
	const metadata = createMetadataInfo(program, { canonicalVisibility: Visibility.Read });
	const found = new Set<Type>();
	const visit = (type: Type): void => {
		if (found.has(type)) return;
		if (type.kind === "Model") {
			found.add(type);
			for (const property of type.properties.values()) visit(property.type);
			if (type.baseModel !== undefined) visit(type.baseModel);
			for (const derived of type.derivedModels) visit(derived);
			if (type.indexer !== undefined) visit(type.indexer.value);
		} else if (type.kind === "Union") {
			found.add(type);
			for (const variant of type.variants.values()) visit(variant.type);
		} else if (type.kind === "Enum") {
			found.add(type);
		} else if (type.kind === "UnionVariant") {
			visit(type.type);
		}
	};
	for (const operation of service.operations.values()) {
		for (const response of operation.responses) {
			for (const content of response.responses) {
				if (content.body === undefined) continue;
				visit(metadata.getEffectivePayloadType(content.body.type, Visibility.Read));
			}
		}
	}
	return found;
}

/** The document openapi3 wrote for one service, at the first graded version. */
function documentFor(
	openapiDir: string,
	service: EmittedService,
	services: number,
	latestVersion: string | undefined,
): { components?: { schemas?: Record<string, unknown> } } | undefined {
	const dir = openapiDirFor(openapiDir, GRADED_OPENAPI_VERSIONS[0]);
	let names: string[];
	try {
		names = readdirSync(dir).filter((name) => name.endsWith(".json"));
	} catch {
		return undefined;
	}
	const serviceName = getNamespaceFullName(service.service.namespace);
	const candidates =
		services === 1 ? names : names.filter((name) => name.startsWith(`openapi.${serviceName}.`));
	const chosen =
		latestVersion === undefined
			? candidates.length === 1
				? candidates[0]
				: undefined
			: candidates.find((name) => name.endsWith(`.${latestVersion}.json`));
	return chosen === undefined ? undefined : JSON.parse(readFileSync(join(dir, chosen), "utf8"));
}

interface Tally {
	servicesRead: number;
	/** Entries checked against the component and the export they name. */
	entriesGraded: number;
	/** Types a response reaches whose validated component has to have an entry. */
	reachedGraded: number;
	/** Components the module validates, each accounted for as an entry or a view. */
	componentsGraded: number;
	readonly problems: string[];
}

const tally: Tally = {
	servicesRead: 0,
	entriesGraded: 0,
	reachedGraded: 0,
	componentsGraded: 0,
	problems: [],
};

beforeAll(async () => {
	for (const scenario of [...discoverScenarios(), ...depthSources()]) {
		const compiled = await compileScenario(scenario, outRoot);
		if (compiled.failure !== undefined || compiled.program === undefined) continue;
		const { program } = compiled;
		// As the compile handed them to this emitter: an emitter reads its options untyped.
		const options = (program.compilerOptions.options?.["typespec-http-zod"] ??
			{}) as EmitContext["options"];
		const services = await emitHttpZod({
			program,
			emitterOutputDir: compiled.zodDir,
			options,
			perf,
		});
		for (const service of services) {
			const where = `${scenario.name} ${getNamespaceFullName(service.service.namespace)}`;
			const document = documentFor(
				compiled.openapiDir,
				service,
				services.length,
				compiled.latestVersion,
			);
			const components = document?.components?.schemas;
			if (components === undefined) continue;
			let module: Record<string, unknown>;
			try {
				module = (await import(join(service.outputDir, "schemas.gen.ts"))) as Record<
					string,
					unknown
				>;
			} catch (thrown) {
				tally.problems.push(`${where}: schemas.gen.ts did not load: ${String(thrown)}`);
				continue;
			}
			tally.servicesRead += 1;

			// Every entry names its type's component, under the identifier the module exports for it.
			const named = new Set<string>();
			for (const [type, identifier] of service.typeSchemaNames) {
				tally.entriesGraded += 1;
				const component = componentNameOf(program, type, service);
				named.add(component);
				if (!(component in components)) {
					tally.problems.push(
						`${where}: ${identifier} keys a type openapi3 publishes no '${component}' for`,
					);
					continue;
				}
				const [plain, renamed] = identifiersFor(component);
				const expected = module[plain] === undefined ? renamed : plain;
				if (identifier !== expected) {
					tally.problems.push(
						`${where}: '${component}' is ${expected}, and the entry says ${identifier}`,
					);
				}
				const validator = module[identifier];
				if (!isValidator(validator)) {
					tally.problems.push(`${where}: ${identifier} is not exported by schemas.gen.ts`);
				} else if (validator._zod.def.type === "never") {
					tally.problems.push(`${where}: ${identifier} validates nothing, and has an entry`);
				}
			}

			// Every type a response reaches has its entry, where the document publishes a component for
			// it under its own name and the module validates that component.
			for (const type of responseTypesOf(program, service)) {
				const component = componentNameOf(program, type, service);
				if (!(component in components)) continue;
				const [plain, renamed] = identifiersFor(component);
				const validator = module[plain] ?? module[renamed];
				if (!isValidator(validator) || validator._zod.def.type === "never") continue;
				tally.reachedGraded += 1;
				if (!service.typeSchemaNames.has(type)) {
					tally.problems.push(`${where}: '${component}' is reached by a response and has no entry`);
				}
			}

			/**
			 * And every component the module validates is accounted for: the component of a type's own
			 * name has its entry, and any other is a view openapi3 names after a type - its visibility
			 * suffix, or a multipart body's.
			 */
			const entries = new Set(service.typeSchemaNames.values());
			const own = new Set<string>();
			const add = (type: Type): void => {
				if ((type as { name?: unknown }).name === "") return;
				own.add(componentNameOf(program, type, service));
			};
			navigateProgram(program, { model: add, union: add, enum: add });
			for (const component of Object.keys(components)) {
				const [plain, renamed] = identifiersFor(component);
				const validator = module[plain] ?? module[renamed];
				if (!isValidator(validator) || validator._zod.def.type === "never") continue;
				tally.componentsGraded += 1;
				if (named.has(component)) continue;
				/**
				 * One type openapi3 publishes twice, its name qualified once: `Server.Path.Multiple.Versions`
				 * beside `Versions`, the server variable's enum read as declared and as projected to the
				 * version. The module declares it once, and the entry names that declaration.
				 */
				const identifier = module[plain] === undefined ? renamed : plain;
				if (component.includes(".") && entries.has(identifier)) continue;
				if (own.has(component)) {
					tally.problems.push(
						`${where}: '${component}' is a type's own component, validated, with no entry`,
					);
				} else if (!isViewOf(component, own)) {
					tally.problems.push(
						`${where}: '${component}' is validated, and is neither an entry nor a view`,
					);
				}
			}
		}
	}
}, 900_000);

describe("typeSchemaNames, over the corpus", () => {
	/**
	 * **Floors just under the measured values**, so a harness that stops finding documents, modules
	 * or entries fails here rather than passing on nothing. Measured on `http-specs@0.1.0-alpha.44`
	 * and the depth sources: 53 services read, 308 entries, 251 types a response reaches, 313
	 * components the module validates.
	 */
	it("reads the corpus at all", () => {
		expect(tally.servicesRead).toBeGreaterThanOrEqual(50);
		expect(tally.entriesGraded).toBeGreaterThanOrEqual(300);
		expect(tally.reachedGraded).toBeGreaterThanOrEqual(245);
		expect(tally.componentsGraded).toBeGreaterThanOrEqual(305);
	});

	it("names, for every entry, the component openapi3 publishes and the validator the module exports for it", () => {
		expect(tally.problems).toEqual([]);
	});
});
