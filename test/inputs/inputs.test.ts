import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **`WireInputs` states the input a handler receives, for every operation.** See `inputs.tsp`.
 *
 * Compiled rather than read: each expectation below is a type written out from the spec, compared
 * with `Identical`, so a contract that is wider, narrower or keyed differently fails to compile. The
 * server emitters render a handler's input from `EmittedRoute.bodyProperty`, `optionalBody` and
 * `rawBodyProperty`; these are the same facts, spelled the way a framework-free consumer reads them.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "inputs", { outName: "inputs" });
}, 300_000);

function withConsumer(source: string): { output: string; failed: boolean } {
	const file = join(compiled.outDir, "consumer.ts");
	writeFileSync(file, source);
	try {
		return typecheckEmitted(compiled.outDir);
	} finally {
		rmSync(file, { force: true });
	}
}

const PRELUDE = `import type { AuthorizationRequest, ByteStream, Charge, Colour, Event, WireInputs } from "./requests.gen.js";

type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;
// Every name above is referenced, so an arm that uses only some of them still compiles cleanly.
export type Referenced = [AuthorizationRequest, ByteStream, Charge, Colour, Event, WireInputs, MustHold<Identical<1, 1>>];
`;

describe("every operation's input, as the handler receives it", () => {
	it("compiles with no error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("keys every operation the service declares, including one that takes no input", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
export type Keys = MustHold<Identical<keyof WireInputs,
	| "readThing" | "createThing" | "cancelPending" | "createCharge" | "authorize" | "ingestEvents"
	| "ingestEvent" | "setColour" | "setNote" | "upload" | "signed" | "submitForm" | "ranged" | "uploadFile">>;
export type Nothing = MustHold<Identical<WireInputs["cancelPending"], Record<string, never>>>;
export type RangeOnly = MustHold<Identical<WireInputs["ranged"], { q: string }>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	it("merges a model body, and the parameters, as before", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
export type Params = MustHold<Identical<WireInputs["readThing"], { id: string }>>;
export type Model = MustHold<Identical<WireInputs["createThing"], { id: string }>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	it("names every body the merge cannot express, under its parameter's name", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
export type Union = MustHold<Identical<WireInputs["createCharge"], { id: string; body: Charge }>>;
export type Optional = MustHold<Identical<WireInputs["authorize"], { body?: AuthorizationRequest }>>;
export type List = MustHold<Identical<WireInputs["ingestEvents"], { body: Event[] }>>;
export type Indexed = MustHold<Identical<WireInputs["ingestEvent"], { body: Event }>>;
export type Enum = MustHold<Identical<WireInputs["setColour"], { colour: Colour }>>;
export type Text = MustHold<Identical<WireInputs["setNote"], { note: string; "Content-Type": "text/plain" }>>;
export type Multipart = MustHold<Identical<WireInputs["submitForm"], { body?: { title: string }; "Content-Type": "multipart/form-data" }>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	/**
	 * **A binary body is a stream, spelled so that no ambient library is needed to name it.** The
	 * server hands the handler the unread `ReadableStream<Uint8Array> | null`; a contracts package
	 * compiled under `lib: ["ES2024"]` and no `types` cannot name `ReadableStream`, so the contract
	 * states the reader a stream has. A platform `ReadableStream<Uint8Array>` is assignable to it under
	 * lib.dom, webworker, `@cloudflare/workers-types` and `@types/node`, on TypeScript 5.9 and 7.0.
	 */
	it("hands a bytes body over unread: a stream when binary, text when it is not", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
export type Binary = MustHold<Identical<WireInputs["upload"], { body: ByteStream | null; "Content-Type": "application/octet-stream" }>>;
export type Signed = MustHold<Identical<WireInputs["signed"], { payload: string; "Content-Type": "application/json" }>>;
// A file is its contents, unread, and the media type the request declared is an input.
export type File = MustHold<Identical<WireInputs["uploadFile"], { file: ByteStream | null; "Content-Type": "image/png" | "image/jpeg" }>>;

// @ts-expect-error a buffer is not the stream the server hands over
export const buffered: WireInputs["upload"] = { body: new ArrayBuffer(1), "Content-Type": "application/octet-stream" };
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	/**
	 * **There is one name for an operation's input: `WireInputs["op"]`.** A per-operation alias,
	 * `CreateUserInput` for `createUser`, is the name half the specs in existence give their own body
	 * model, and the two declarations collided (`TS2300`), so the contracts did not compile.
	 */
	it("declares no per-operation alias beside the lookup", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
// @ts-expect-error the per-operation alias is gone
import type { ReadThingInput } from "./requests.gen.js";
export type Unused = ReadThingInput;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
