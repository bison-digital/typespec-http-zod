import { getAllHttpServices, getHttpService, type HttpService } from "@typespec/http";
import { listServices, type Program } from "@typespec/compiler";
import { unsafe_mutateSubgraphWithNamespace } from "@typespec/compiler/experimental";

/**
 * **Serve the version the service is on, not every version it has ever had.**
 *
 * **The emitter used to emit the UNION of all versions.** Measured on
 * `versioning/removed`: v2 deletes `POST /v1` and `POST /interface-v1/v1`, and both were mounted
 * anyway - 582 routes against the 580 the document declares. A service built on that output serves
 * endpoints its current version does not have, validates bodies against properties a later version
 * removed, and does all of it while the document says otherwise.
 *
 * It stayed hidden because the oracle was reading the wrong file: `versioning/removed` declares
 * `v1, v2preview, v2`, the documents sort alphabetically, and the differential compared us against
 * `openapi.v2preview.json`. Fixing WHICH document is read is what made this visible at all.
 *
 * **`@typespec/versioning` is an OPTIONAL peer, behind a guarded `import()`** - the same treatment
 * `@typespec/streams` gets, and for the same reason: a spec that declares no versions must not need
 * the package installed. `@typespec/openapi3` resolves it exactly this way (`versioning-module.js`),
 * so a service is versioned for us precisely when it is versioned for the document we are judged
 * against.
 */

interface VersionSnapshot {
	readonly version?: { readonly value: string };
	readonly mutator: unknown;
}

interface VersioningModule {
	readonly getVersioningMutators: (
		program: Program,
		namespace: unknown,
	) =>
		| { readonly kind: "transient"; readonly mutator: unknown }
		| { readonly kind: "versioned"; readonly snapshots: readonly VersionSnapshot[] }
		| undefined;
}

export async function resolveVersioningModule(): Promise<VersioningModule | undefined> {
	try {
		return (await import("@typespec/versioning")) as unknown as VersioningModule;
	} catch {
		return undefined;
	}
}

/** A service to emit, and the version it represents where there is one. */
export interface ServiceSnapshot {
	readonly service: HttpService;
	/** The version this snapshot is of. `undefined` for an unversioned service. */
	readonly version?: string;
}

/**
 * Every service to emit, each already projected to its current version.
 *
 * **The LAST snapshot, not a merge and not a choice.** `getVersioningMutators` returns snapshots
 * in declared order - which is the only order that means anything, since a version name sorts
 * however its author spelled it (`v2preview` sorts after `v2`). The last one is what the service
 * currently serves, and one schema set can only describe one version.
 *
 * Serving an older version would be a legitimate thing to want and is deliberately NOT offered here:
 * it needs an option, a name for the emitted directory, and an answer for what the contracts package
 * exports. Emitting the union - which is what happened before - is not that feature, it is the
 * absence of this one.
 */
export function serviceSnapshots(
	program: Program,
	versioning: VersioningModule | undefined,
): ServiceSnapshot[] {
	const [unversioned] = getAllHttpServices(program);
	if (versioning === undefined) return unversioned.map((service) => ({ service }));

	const snapshots: ServiceSnapshot[] = [];
	for (const service of listServices(program)) {
		const mutators = versioning.getVersioningMutators(program, service.type);
		if (mutators === undefined) {
			// Not versioned: the service as written is the service that runs.
			const match = unversioned.find((candidate) => candidate.namespace === service.type);
			if (match !== undefined) snapshots.push({ service: match });
			continue;
		}
		const mutator =
			mutators.kind === "transient" ? mutators.mutator : mutators.snapshots.at(-1)?.mutator;
		const version =
			mutators.kind === "transient" ? undefined : mutators.snapshots.at(-1)?.version?.value;
		if (mutator === undefined) continue;
		const projected = projectService(program, service.type, mutator);
		if (projected !== undefined) {
			snapshots.push(
				version === undefined ? { service: projected } : { service: projected, version },
			);
		}
	}
	// A versioned spec whose mutators produced nothing must not silently emit nothing at all.
	return snapshots.length === 0 ? unversioned.map((service) => ({ service })) : snapshots;
}

function projectService(
	program: Program,
	namespace: unknown,
	mutator: unknown,
): HttpService | undefined {
	const subgraph = unsafe_mutateSubgraphWithNamespace(
		program,
		[mutator as never],
		namespace as never,
	);
	if (subgraph.type.kind !== "Namespace") return undefined;
	const [service] = getHttpService(program, subgraph.type);
	return service;
}
