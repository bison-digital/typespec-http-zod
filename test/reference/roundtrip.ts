import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertOpenAPI3Document } from "@typespec/openapi3";
import { parse as parseYaml } from "yaml";
import { compileScenario, type CompiledScenario } from "../conformance/corpus.js";

/**
 * **Round-trip fidelity against APIs nobody here designed.**
 *
 * `@typespec/http-specs` proves this emitter against scenarios built to break emitters. It does not
 * prove it against an API someone sat down and designed — which is the thing it will actually be
 * pointed at. These are real published OpenAPI documents, converted to TypeSpec by
 * `tsp-openapi3` and compiled back out:
 *
 * ```
 *   reference document → convertOpenAPI3Document → TypeSpec → our emitter + openapi3
 *                                                                    ↓
 *                                        emitted document, compared against the ORIGINAL
 * ```
 *
 * Two questions only this loop asks. **Can we serve a surface we did not write?** — every assumption
 * baked into a fixture of ours or into a scenario file is absent here. And **does meaning survive the
 * round trip?** — the emitted document has to still declare the operations the original did, or
 * something between the converter and this emitter has quietly dropped part of an API.
 *
 * ⚠️ **Vendored, not fetched.** A suite that reaches the network decides whether it passes using a
 * value it did not supply, and then fails for reasons that have nothing to do with the code. The
 * documents are committed with their provenance in `documents/PROVENANCE.md`; refreshing one is a
 * deliberate commit, and the diff shows exactly what moved.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const documentsDir = join(here, "documents");
export const convertedDir = join(here, ".out");

export interface ReferenceApi {
	/** `oai-petstore` — stable, and what the baseline is keyed on. */
	readonly name: string;
	/** The published document, exactly as vendored. */
	readonly original: OpenApi3Document;
}

export interface OpenApi3Document {
	readonly openapi?: string;
	readonly paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	readonly components?: { readonly schemas?: Record<string, unknown> };
}

const HTTP_VERBS = new Set(["get", "put", "post", "patch", "delete", "head", "options", "trace"]);

/** Every `path + method` the document declares, as `GET /pets/{id}`. */
export function operationsOf(document: OpenApi3Document): string[] {
	const found: string[] = [];
	for (const [path, item] of Object.entries(document.paths ?? {})) {
		for (const verb of Object.keys(item)) {
			if (HTTP_VERBS.has(verb)) found.push(`${verb.toUpperCase()} ${path}`);
		}
	}
	return found.toSorted();
}

/** The vendored reference documents, discovered rather than listed. */
export function discoverReferenceApis(): readonly ReferenceApi[] {
	return readdirSync(documentsDir)
		.filter((file) => file.endsWith(".json") || file.endsWith(".yaml"))
		.toSorted()
		.map((file) => {
			const raw = readFileSync(join(documentsDir, file), "utf8");
			return {
				name: file.replace(/\.(json|yaml)$/, ""),
				original: (file.endsWith(".yaml") ? parseYaml(raw) : JSON.parse(raw)) as OpenApi3Document,
			};
		});
}

/**
 * Convert one reference document to TypeSpec and compile it with both emitters.
 *
 * The conversion runs every time rather than being committed. A committed `.tsp` would freeze
 * whatever the converter did on the day it was generated, and this loop is partly a check that the
 * converter and this emitter still agree about the same document — which a frozen artefact cannot
 * notice.
 */
export async function roundTrip(api: ReferenceApi): Promise<CompiledScenario> {
	const projectDir = join(convertedDir, api.name);
	mkdirSync(projectDir, { recursive: true });
	const mainFile = join(projectDir, "main.tsp");
	writeFileSync(mainFile, await convertOpenAPI3Document(api.original as never));
	return compileScenario({ name: `reference/${api.name}`, mainFile });
}
