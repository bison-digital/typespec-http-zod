import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/** See `shape.tsp`. Every defect here made the emitter's own output fail on its own terms. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let requests: string;
let schemas: string;

beforeAll(async () => {
	compiled = await compileFixture(here, "shape", { outName: "contractshape" });
	requests = readFileSync(join(compiled.outDir, "requests.gen.ts"), "utf8");
	schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
}, 300_000);

/**
 * Compile one hand-written consumer file against the emitted output, then take it away again.
 *
 * **Written at run time rather than committed beside this test**, because a checked-in file
 * importing `.out/` would make `pnpm typecheck` depend on a build step and fail on a fresh clone -
 * the trap `support/compile-fixture.ts` already records. Removed afterwards so each arm is graded on
 * its own file alone and a failure names one thing.
 */
function withConsumer(source: string): { output: string; failed: boolean } {
	const file = join(compiled.outDir, "consumer.ts");
	writeFileSync(file, source);
	try {
		return typecheckEmitted(compiled.outDir);
	} finally {
		rmSync(file, { force: true });
	}
}

describe("the request type and its validator describe one shape", () => {
	it("emits the request types this suite reads", () => {
		for (const name of ["UploadInput", "OpenRequest", "ClosedRequest", "OpenParent", "OpenChild"]) {
			expect(requests, `${name} is missing`).toContain(name);
		}
	});

	it("carries a multipart body's PARTS, not just its headers", () => {
		const input = /export type UploadInput = Simplify<([\s\S]*?)>;/.exec(requests)?.[1] ?? "";
		expect(input, "no UploadInput found").not.toBe("");
		expect(input).toContain("file:");
		expect(input).toContain("alt?:");
	});

	it("unwraps HttpPart, matching what the validator walks", () => {
		// `file: {}` would be the HttpPart wrapper; the validator unwraps to the part's own type.
		expect(requests).not.toMatch(/file: \{\};/);
	});

	/**
	 * **The contract type is a floor: these fields, at least.**
	 *
	 * `0.16.0` put `[key: string]: unknown` here so that the type, the validator and the document all
	 * said `additionalProperties`. Two of those are statements about what a validator TOLERATES on
	 * arrival; the third became an obligation on whoever produces the value, and an interface has no
	 * implicit index signature (TypeScript #15300), so no domain type could satisfy it without a
	 * copy. See the satisfiability arm below for the cost.
	 */
	it("gives an open model NO catchall, so a producer can satisfy it", () => {
		const open = /interface OpenRequest \{([\s\S]*?)\}/.exec(requests)?.[1] ?? "";
		expect(open, "no OpenRequest found").not.toBe("");
		expect(open).not.toContain("[key: string]");
	});

	it("gives a closed model none either, so nothing was invented", () => {
		const closed = /interface ClosedRequest \{([\s\S]*?)\}/.exec(requests)?.[1] ?? "";
		expect(closed, "no ClosedRequest found").not.toBe("");
		expect(closed).not.toContain("[key: string]");
	});
});

/**
 * **The openness claim, asserted directly rather than as a side effect.**
 *
 * Until this arm existed, that an open model gets a permissive validator was only ever checked
 * incidentally - by `wire-contract.gen.ts` comparing the inferred type against the emitted one. Now
 * that the two artefacts legitimately differ on this axis, the comparison no longer covers it, so
 * the claim is made here instead. Coverage moves; it does not disappear.
 *
 * Spelled to accept either form: `z.looseObject({...})` and `z.object({...}).loose()` are the same
 * schema. What is asserted here is that the validator is OPEN, which is the fact the document also
 * states; which of the two spellings the emitter chooses is not this arm's business, and pinning it
 * would turn a claim about behaviour into a golden-file check.
 */
describe("the validator still says what the document says about openness", () => {
	it("gives an open model a permissive validator", () => {
		const declaration = /export const openRequestSchema = ([\s\S]*?);\n/.exec(schemas)?.[1] ?? "";
		expect(declaration, "no openRequestSchema found").not.toBe("");
		expect(declaration).toMatch(/z\.looseObject\(|\.loose\(\)/);
	});

	it("gives a nested open model one too, at every level", () => {
		const declaration = /export const openChildSchema = ([\s\S]*?);\n/.exec(schemas)?.[1] ?? "";
		expect(declaration, "no openChildSchema found").not.toBe("");
		expect(declaration).toMatch(/z\.looseObject\(|\.loose\(\)/);
	});

	it("seals a closed model, so the two artefacts still agree it is closed", () => {
		const declaration = /export const closedRequestSchema = ([\s\S]*?);\n/.exec(schemas)?.[1] ?? "";
		expect(declaration, "no closedRequestSchema found").not.toBe("");
		expect(declaration).toMatch(/z\.strictObject\(|\.strict\(\)/);
	});
});

/**
 * **Can a consumer hand its own value to the shape we published?**
 *
 * Nothing else in either package asks this. Every other arm reads emitted text, and text cannot see
 * an assignability failure - which is how `0.16.0` shipped a response type that no plain interface
 * could satisfy. The domain types below are declared with `interface` deliberately: a `type` alias
 * gets an implicit index signature and a plain interface does not, so an interface is the case that
 * actually fails, and it is what most codebases have.
 *
 * **No spread anywhere.** A spread is the documented workaround for exactly this, and a consumer
 * reached for it at every level of a 26-deep tree. If this arm needs one, the emitter is wrong.
 */
describe("a domain value satisfies the published shape without being copied", () => {
	it("accepts a plain interface as a response, nested open models and all", () => {
		const { output, failed } = withConsumer(`
import type { WireOutputs } from "./requests.gen.js";

interface DomainChild {
	id: string;
}

interface DomainParent {
	code: string;
	child: DomainChild;
}

const child: DomainChild = { id: "i" };
const parent: DomainParent = { code: "c", child };

export const response: WireOutputs["nested"] = parent;
`);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});

	it("accepts one as the named contract type a codebase passes around", () => {
		const { output, failed } = withConsumer(`
import type { OpenParent, OpenChild } from "./requests.gen.js";

interface DomainChild {
	id: string;
}

interface DomainParent {
	code: string;
	child: DomainChild;
}

const child: DomainChild = { id: "i" };
const parent: DomainParent = { code: "c", child };

export const asChild: OpenChild = child;
export const asParent: OpenParent = parent;
`);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});

	/**
	 * **A file part is `unknown`, and a consumer narrows it at the boundary. That is not an
	 * oversight, and this arm exists so it is not "fixed" by accident.**
	 *
	 * `@typespec/openapi3` publishes a bare `{}` for a File part - verified against this package's
	 * own conformance output, in 3.1, and even for a part declaring a specific content type. `{}`
	 * permits a text field, so a validator that insisted on a file would refuse a payload the
	 * published contract allows, and a TYPE that claimed one would assert what nothing checked.
	 *
	 * Both were built and reverted in `0.17.0`; see `isBinaryPart` for what each one broke. The day
	 * the document says what the part is, this arm should fail and be replaced.
	 */
	it("leaves a multipart file part unknown, because the document says nothing about it", () => {
		const { output, failed } = withConsumer(`
import type { WireInputs } from "./requests.gen.js";

interface FileLike {
	readonly name: string;
	arrayBuffer: () => Promise<ArrayBuffer>;
}

const isFile = (value: unknown): value is FileLike =>
	typeof value === "object" && value !== null && "arrayBuffer" in value;

// The narrowing a consumer writes, once, at the edge - and it type-checks, which is the claim.
export function nameOf(input: WireInputs["upload"]): string {
	return isFile(input.file) ? input.file.name : "";
}
`);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});
});
