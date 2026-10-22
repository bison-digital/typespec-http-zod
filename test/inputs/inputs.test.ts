import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllHttpServices } from "@typespec/http";
import { beforeAll, describe, expect, it } from "vitest";
import { collectRoutes } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
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

const PRELUDE = `import type { ByteStream, Colour, Event, Renaming, SearchRequest, Shape, Widget, WireInputs } from "./requests.gen.js";

type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;
// Every name above is referenced, so an arm that uses only some of them still compiles cleanly.
export type Referenced = [ByteStream, Colour, Event, Renaming, SearchRequest, Shape, Widget, WireInputs, MustHold<Identical<1, 1>>];
`;

describe("every operation's input, as the handler receives it", () => {
	it("compiles with no error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("keys every operation the service declares, including one that takes no input", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
export type Keys = MustHold<Identical<keyof WireInputs,
	| "readThing" | "createThing" | "cancelPending" | "createShape" | "search" | "recordEvents"
	| "recordEvent" | "setColour" | "setNote" | "upload" | "signed" | "submitForm" | "ranged" | "uploadFile" | "putXml" | "listColours"
	| "rename" | "replaceWidget" | "putXmlOnly" | "putBlobOnly">>;
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
// An array encoding on a query parameter says how it was flattened; the validator splits it back.
export type Delimited = MustHold<Identical<WireInputs["listColours"], { colors: string[] }>>;
// A read-only body property is shared into the request, still required, so it collides: named.
export type ReadOnlyCollision = MustHold<Identical<WireInputs["replaceWidget"], { id: string; body: Widget }>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	it("names every body the merge cannot express, under its parameter's name", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
export type Union = MustHold<Identical<WireInputs["createShape"], { id: string; body: Shape }>>;
export type Optional = MustHold<Identical<WireInputs["search"], { body?: SearchRequest }>>;
export type List = MustHold<Identical<WireInputs["recordEvents"], { body: Event[] }>>;
export type Indexed = MustHold<Identical<WireInputs["recordEvent"], { body: Event }>>;
export type Enum = MustHold<Identical<WireInputs["setColour"], { colour: Colour }>>;
export type Text = MustHold<Identical<WireInputs["setNote"], { note: string; "Content-Type": "text/plain" }>>;
export type Multipart = MustHold<Identical<WireInputs["submitForm"], { body?: { title: string }; "Content-Type": "multipart/form-data" }>>;
// A body key equal to a parameter's name: merged, one value would replace the other.
export type Collides = MustHold<Identical<WireInputs["rename"], { name: string; body: Renaming }>>;
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
// A model under XML is the text that arrived: nothing here can parse it.
export type Xml = MustHold<Identical<WireInputs["putXml"], { body: string; "Content-Type": "application/xml" }>>;
// A file is its contents, unread, and the media type the request declared is an input.
export type File = MustHold<Identical<WireInputs["uploadFile"], { file: ByteStream | null; "Content-Type": "image/png" | "image/jpeg" }>>;

// @ts-expect-error a buffer is not the stream the server hands over
export const buffered: WireInputs["upload"] = { body: new ArrayBuffer(1), "Content-Type": "application/octet-stream" };
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	/**
	 * **A model the document declares is declared here, whichever media type carries it.** A body
	 * under XML is handed over as text, so no lookup names its model; 0.27.0 declared it all the same,
	 * and `openapi-typescript` declares every component. Dropping it broke an import that worked.
	 */
	it("declares a model named only under XML, though the lookups type its body as text", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
import type { WireOutputs, XmlRequest, XmlResponse } from "./requests.gen.js";
export type Request = MustHold<Identical<XmlRequest, { note: string }>>;
export type Response = MustHold<Identical<XmlResponse, { echo: string }>>;
export type Input = MustHold<Identical<WireInputs["putXmlOnly"], { body: string; "Content-Type": "application/xml" }>>;
export type Output = MustHold<Identical<WireOutputs["putXmlOnly"], string>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	/**
	 * **A model under a media type that is not text is bytes, both ways.** Handed over as text, an
	 * `application/octet-stream` body lost every byte that is not valid UTF-8, and a result typed
	 * `string` could not carry one.
	 */
	it("hands a model under a media type that is not text over as bytes, and answers it as bytes", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
import type { BlobRequest, BlobResponse, WireOutputs } from "./requests.gen.js";
export type Request = MustHold<Identical<BlobRequest, { note: string }>>;
export type Response = MustHold<Identical<BlobResponse, { echo: string }>>;
export type Input = MustHold<Identical<WireInputs["putBlobOnly"], { body: ByteStream | null; "Content-Type": "application/octet-stream" }>>;
export type Output = MustHold<Identical<WireOutputs["putBlobOnly"], ByteStream | Uint8Array<ArrayBuffer> | ArrayBuffer>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	/**
	 * **The route says which raw bodies are bytes, and which carry a schema nothing checks**, which is
	 * what a server emitter reads to read the body and to say it is unchecked.
	 */
	it("records each raw body as bytes or text, and whether its schema goes unchecked", () => {
		const [[service]] = getAllHttpServices(compiled.program);
		if (service === undefined) throw new Error("no service");
		const facts = Object.fromEntries(
			collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service)
				.filter((route) => route.rawBodyProperty !== undefined)
				.map((route) => [route.operationId, [route.rawBodyBinary, route.rawBodyUnvalidated]]),
		);
		expect(facts).toEqual({
			upload: [true, false],
			signed: [false, false],
			uploadFile: [true, false],
			putXml: [false, true],
			putXmlOnly: [false, true],
			putBlobOnly: [true, true],
		});
	});

	/**
	 * **There is one name for an operation's input: `WireInputs["op"]`.** A per-operation alias,
	 * `CreateUserInput` for `createUser`, is a name a spec may well give its own body model, and the
	 * two declarations collided (`TS2300`), so the contracts did not compile.
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
