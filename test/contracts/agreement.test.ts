import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **The two artefacts describing one operation's input have to name its parameters identically.**
 *
 * `schemas.gen.ts` holds the validators a server enforces, keyed as the wire names them.
 * `requests.gen.ts` holds the type a consumer's handler is checked against. One program generates
 * both, and until this arm existed nothing compared them: `wire-contract.gen.ts` pairs a validator
 * against a contract type for MODELS, and a merged input type is not a model. A docblock in `api.ts`
 * said so outright.
 *
 * Two defects lived in that gap and both reached a published release, found by a consumer rather
 * than here:
 *
 * - `@header("x-thing") thing: string` was keyed `"x-thing"` by the validator and `thing` by the
 *   type, so a handler satisfying the type could not typecheck against a correct server;
 * - a `bytes` body was typed `string` whatever media type it was served as, while the server hands
 *   the handler raw bytes.
 *
 * This suite already emitted both files for every fixture, so the gap was not a missing artefact: it
 * was that nothing read the two together. The sibling's end-to-end left `contracts-output-dir` unset
 * and so never emitted the second file at all, which is why neither repository caught it.
 *
 * Asserted as a CLASS over every operation the fixture declares, rather than over the two shapes
 * that happened to break.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

const PARAMETER_SUFFIXES = ["Path", "Query", "Header", "Cookie"] as const;

describe("the validators and the contract types name one operation's input the same way", () => {
	let compiled: CompiledFixture;
	let parameterValidators: string[] = [];

	beforeAll(async () => {
		compiled = await compileFixture(here, "agreement");
		/**
		 * **The validators an operation's parameters go through, read off the module itself.** The
		 * names are the module's exports, which is the interface a server imports, rather than a
		 * pattern matched against its text: the regexes this replaced keyed on a per-operation alias
		 * that no longer exists, and a pattern that stops matching reports agreement about nothing.
		 */
		const module = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<
			string,
			unknown
		>;
		parameterValidators = Object.keys(module).filter((name) =>
			PARAMETER_SUFFIXES.some((suffix) => name.endsWith(suffix)),
		);
	}, 120_000);

	function compiles(source: string): { output: string; failed: boolean } {
		const file = join(compiled.outDir, "agreement.consumer.ts");
		writeFileSync(file, source);
		try {
			return typecheckEmitted(compiled.outDir);
		} finally {
			rmSync(file, { force: true });
		}
	}

	it("emits both artefacts, without which the arms below compare nothing", () => {
		expect(compiled.diagnostics).toEqual([]);
		// Non-vacuity: an unset `contracts-output-dir` is exactly how this gap survived, and three
		// validators is what the fixture's renamed path, header and query parameters produce.
		expect(parameterValidators.length).toBeGreaterThanOrEqual(3);
	});

	it("names every parameter the same way in both", () => {
		const assertions = parameterValidators.map((name) => {
			const suffix = PARAMETER_SUFFIXES.find((candidate) => name.endsWith(candidate)) ?? "";
			const operationId = name.slice(0, name.length - suffix.length);
			return `export type ${name}Agrees = MustHold<Covers<z.input<typeof ${name}>, WireInputs["${operationId}"]>>;`;
		});
		const { output, failed } = compiles(`import type { z } from "zod";
import type { WireInputs } from "./requests.gen.js";
import type { ${parameterValidators.join(", ")} } from "./schemas.gen.js";

/** Every key the validator declares is a key of the contract input, by the same wire name. */
type Covers<V, I> = [Exclude<keyof V, keyof I>] extends [never] ? true : ["missing from the type", Exclude<keyof V, keyof I>];
type MustHold<T extends true> = T;

${assertions.join("\n")}
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	it("types a raw binary body as a stream, not as text", () => {
		/**
		 * The document publishes `application/octet-stream` with `format: binary` for a `bytes` body,
		 * and the server hands the handler the unread stream. Typing it `string` is the request half of
		 * the corruption already fixed on the reader - decoding raw bytes as text replaces every byte
		 * outside ASCII - and typing it `ArrayBuffer` made a gateway read the whole body to satisfy it.
		 */
		const { output, failed } =
			compiles(`import type { ByteStream, WireInputs } from "./requests.gen.js";

type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;

export type RawIsAStream = MustHold<Identical<WireInputs["rawBytes"]["body"], ByteStream | null>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
