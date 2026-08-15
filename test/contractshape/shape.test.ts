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
	 * **A part declared `HttpPart<File>` is typed as a file, and the validator establishes it.**
	 *
	 * `@typespec/openapi3` publishes a bare `{}` for such a part - verified against this package's
	 * own conformance output, in 3.1, and even where the part declares a content type. That is
	 * OpenAPI's IDIOM for binary content in a multipart body, not a statement that any value is
	 * acceptable, and the transport agrees: Hono types a part as `string | File` and nothing else.
	 *
	 * So the check can refuse exactly one thing - a text field where the spec declared a file - and
	 * that request is malformed against the spec. A spec that means "either" says
	 * `HttpPart<File | string>`, so nothing becomes inexpressible. `0.17.0` left this as `unknown`,
	 * where the same input reached a handler as an unusable value and became a 500 or a silent
	 * misreading instead of a 400 naming the part.
	 */
	/**
	 * **An optional property may be omitted, supplied, or passed as an explicit `undefined`.**
	 *
	 * The third one looks wrong - JSON has no `undefined` - and removing it was tried and reverted.
	 * `{ note: undefined }` serialises identically to omitting `note`, so permitting it costs the
	 * wire nothing, while refusing it costs every producer a conditional spread and breaks the most
	 * ordinary handler there is: `(ctx, input) => ok(input)`, return what you were given, because
	 * what ARRIVES carries `?: T | undefined`.
	 *
	 * **This is why it is not the same class as the index signature or `readonly`**, which it
	 * resembles. Removing those makes MORE values assignable to a published shape; removing this one
	 * makes fewer. `schemas.gen.ts` still exports the narrow received view via `Exact<>`, and the two
	 * surfaces differ on this axis deliberately.
	 */
	it("lets an optional property be omitted, supplied, or explicitly undefined", () => {
		const { output, failed } = withConsumer(`
import type { Page } from "./requests.gen.js";

export const absent: Page = { entries: [], tags: [] };
export const present: Page = { entries: [], tags: [], note: "n" };

// The echo case: what a handler received, handed straight back.
const received: Page = { entries: [], tags: [], note: undefined };
export const echoed: Page = received;
`);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});

	/**
	 * **`readonly` is a TypeScript variance property, not a wire property.**
	 *
	 * `readonly T[]` and `T[]` serialise to identical bytes, so a codebase whose layers hand back
	 * immutable views should be able to publish one. `Produced<>` already existed for this and said
	 * so - "Mutability is not a fact about a wire shape" - and was applied to `WireOutputs` alone and
	 * exported from nowhere, so no consumer could reach it for a named type.
	 */
	/**
	 * **An index signature arrives two ways, and only one of them is openness.**
	 *
	 * A model spreading `...Record<unknown>` gains one because its validator is loose - a fact about
	 * the model, which the contract type does not state. A property DECLARED `Record<unknown>` gains
	 * one because that is its type, stated identically in both artefacts.
	 *
	 * `Declared<>` recursed into every object and stripped both, so `Record<string, unknown>` became
	 * `{}` and the emitted assertion stopped compiling for any spec with a dictionary property. Found
	 * by a consumer, on four real properties, after `0.17.0`.
	 */
	it("keeps a property whose declared type is a dictionary", () => {
		const declared = /interface Credentials \{([\s\S]*?)\n\}/.exec(requests)?.[1] ?? "";
		expect(declared, "no Credentials found").not.toBe("");
		expect(declared).toContain("claims: Record<string, unknown>");
		expect(declared).toContain("labels: Record<string, string>");
	});

	it("lets a consumer supply a real dictionary for one", () => {
		const { output, failed } = withConsumer(`
import type { Credentials } from "./requests.gen.js";

const claims: Record<string, unknown> = { sub: "abc" };
const labels: Record<string, string> = { env: "prod" };

export const value: Credentials = { token: "t", claims, labels, settings: null };
`);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});

	it("exports the producer view, so a consumer can reach it", () => {
		expect(requests).toMatch(/export type Produced</);
	});

	it("accepts a readonly view where the wire type is an array", () => {
		const { output, failed } = withConsumer(`
import type { Produced, Page, Entry } from "./requests.gen.js";

interface ImmutablePage {
	readonly entries: readonly Entry[];
	readonly tags: readonly string[];
}

const view: ImmutablePage = { entries: [{ id: "a" }], tags: ["t"] };

export const produced: Produced<Page> = view;
`);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});

	it("lets a handler return a readonly view as a response", () => {
		const { output, failed } = withConsumer(`
import type { WireOutputs, Entry } from "./requests.gen.js";

interface ImmutablePage {
	readonly entries: readonly Entry[];
	readonly tags: readonly string[];
}

const view: ImmutablePage = { entries: [{ id: "a" }], tags: ["t"] };

export const response: WireOutputs["page"] = view;
`);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});

	it("lets a handler read a multipart file's name and bytes without a cast", () => {
		const { output, failed } = withConsumer(`
import type { WireInputs } from "./requests.gen.js";

export async function summarise(input: WireInputs["upload"]): Promise<string> {
	const required: string = input.file.name;
	const optional: string = input.thumbnail?.name ?? "none";
	const repeated: string = input.pages.map((page) => page.name).join(",");
	const bytes: ArrayBuffer = await input.file.arrayBuffer();
	return [required, optional, repeated, input.file.type, String(bytes.byteLength)].join(" ");
}
`);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});
});
