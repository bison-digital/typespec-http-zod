import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **`WireOutputs` and `WireResults` state every response an operation declares.** See `results.tsp`.
 *
 * Compiled: each expectation is a type written out from the spec and compared with `Identical`.
 * A `default` arm's codes are every status nothing else claims; rather than restate that list from
 * the table the emitter itself uses, its arms assert membership - `404` in, `200` out where `200` is
 * declared, `204` out where the arm has a body - and that the status is not widened to `number`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "results", { outName: "results" });
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

const PRELUDE = `import type { ByteStream, Deletion, OrgError, Other, Problem, Produced, Thing, WireOutputs, WireResults } from "./requests.gen.js";

type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;
type Bytes = ByteStream | Uint8Array<ArrayBuffer> | ArrayBuffer;
export type Referenced = [Deletion, OrgError, Other, Problem, Produced<Thing>, Thing, WireOutputs, WireResults, Bytes, MustHold<Identical<1, 1>>];
`;

const OPERATIONS = `"getThing" | "mixed" | "bodyOrNone" | "scheduleDeletion" | "cancelDeletion" | "throttled" | "ranged" | "negotiated" | "download" | "image" | "ticks" | "refuse" | "downloadFile"`;

describe("every operation's success bodies, in WireOutputs", () => {
	it("compiles with no error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("keys every operation, and states every success body, not the lowest status's", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
export type Keys = MustHold<Identical<keyof WireOutputs, ${OPERATIONS}>>;
export type One = MustHold<Identical<WireOutputs["getThing"], Produced<Thing>>>;
export type Two = MustHold<Identical<WireOutputs["mixed"], Produced<Thing> | Produced<Other>>>;
export type OrNone = MustHold<Identical<WireOutputs["bodyOrNone"], Produced<Thing> | undefined>>;
export type SameModel = MustHold<Identical<WireOutputs["scheduleDeletion"], Produced<Deletion>>>;
export type NoBody = MustHold<Identical<WireOutputs["cancelDeletion"], undefined>>;
export type Throttled = MustHold<Identical<WireOutputs["throttled"], Produced<Thing>>>;
export type Ranged = MustHold<Identical<WireOutputs["ranged"], Produced<Thing>>>;
export type Text = MustHold<Identical<WireOutputs["negotiated"], string>>;
export type Binary = MustHold<Identical<WireOutputs["download"], Bytes>>;
export type Stream = MustHold<Identical<WireOutputs["ticks"], ByteStream>>;
export type FailuresOnly = MustHold<Identical<WireOutputs["refuse"], never>>;
export type File = MustHold<Identical<WireOutputs["downloadFile"], Bytes>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});

describe("every operation's result, in WireResults", () => {
	it("keys every operation", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
export type Keys = MustHold<Identical<keyof WireResults, ${OPERATIONS}>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	it("pairs each status with its own body", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
export type One = MustHold<Identical<WireResults["getThing"], { readonly status: 200; readonly body: Produced<Thing> }>>;
export type Two = MustHold<Identical<WireResults["mixed"],
	| { readonly status: 200; readonly body: Produced<Thing> }
	| { readonly status: 201; readonly body: Produced<Other> }>>;
export type OrNone = MustHold<Identical<WireResults["bodyOrNone"],
	| { readonly status: 200; readonly body: Produced<Thing> }
	| { readonly status: 204; readonly body?: undefined }>>;
export type Ranged = MustHold<Identical<WireResults["ranged"],
	{ readonly status: 200 | 201 | 202 | 203 | 206 | 207 | 208 | 226; readonly body: Produced<Thing> }>>;
export type Throttled = MustHold<Identical<WireResults["throttled"],
	| { readonly status: 200; readonly body: Produced<Thing> }
	| { readonly status: 429; readonly body: Produced<Problem>; readonly headers: { readonly "Retry-After": string } }>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	it("names the media type where a status offers more than one, or a range", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
export type Negotiated = MustHold<Identical<WireResults["negotiated"],
	| { readonly status: 200; readonly contentType: "application/json"; readonly body: string }
	| { readonly status: 200; readonly contentType: "text/plain"; readonly body: string }>>;
export type Binary = MustHold<Identical<WireResults["download"], { readonly status: 200; readonly body: Bytes }>>;
export type Range = MustHold<Identical<WireResults["image"], { readonly status: 200; readonly contentType: \`image/\${string}\`; readonly body: Bytes }>>;
export type Stream = MustHold<Identical<WireResults["ticks"], { readonly status: 200; readonly body: ByteStream }>>;
export type File = MustHold<Identical<WireResults["downloadFile"],
	| { readonly status: 200; readonly contentType: "image/png"; readonly body: Bytes }
	| { readonly status: 200; readonly contentType: "image/jpeg"; readonly body: Bytes }>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	it("gives a default arm every status nothing else claims, written out", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
type Fallback = Exclude<WireResults["scheduleDeletion"], { readonly status: 200 | 201 }>;
export type Body = MustHold<Identical<Fallback["body"], Produced<OrgError>>>;
export type Has404 = MustHold<404 extends Fallback["status"] ? true : false>;
export type Has503 = MustHold<503 extends Fallback["status"] ? true : false>;
export type Not200 = MustHold<200 extends Fallback["status"] ? false : true>;
export type NotContentless = MustHold<204 extends Fallback["status"] ? false : true>;
export type NotInformational = MustHold<100 extends Fallback["status"] ? false : true>;
export type NotNumber = MustHold<number extends Fallback["status"] ? false : true>;

type Only = WireResults["refuse"];
export type OnlyHas200 = MustHold<200 extends Only["status"] ? true : false>;
export type OnlyBody = MustHold<Identical<Only["body"], Produced<OrgError>>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	/**
	 * **The reporter's case, compiled: a backend choosing 200 or 201 for one model.** Typed by
	 * `WireResults`, it says which, with the status a literal a server can switch on; a status the
	 * operation does not declare does not compile.
	 */
	it("lets a backend say which success it means, and refuses one the operation does not declare", () => {
		const { output, failed } = withConsumer(`${PRELUDE}
declare function scheduled(): Promise<Deletion>;

export const backend: { scheduleDeletion(): Promise<WireResults["scheduleDeletion"]> } = {
	async scheduleDeletion() {
		const deletion = await scheduled();
		return deletion.started ? { status: 200, body: deletion } : { status: 201, body: deletion };
	},
};

// @ts-expect-error getThing declares no 201
export const undeclared: WireResults["getThing"] = { status: 201, body: { id: "t" } };
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
