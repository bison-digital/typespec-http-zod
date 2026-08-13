import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

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

/** The keys of an emitted `z.object({ ... })` const, which is how a validator names a parameter. */
function validatorKeys(source: string, identifier: string): string[] {
	const declaration = new RegExp(
		`export const ${identifier} = z\\.object\\(\\{([\\s\\S]*?)\\n\\}\\)`,
		"m",
	).exec(source);
	if (declaration === null) return [];
	return [...(declaration[1] ?? "").matchAll(/^\t(?:"([^"]+)"|([A-Za-z_$][\w$]*)):/gm)].map(
		(match) => match[1] ?? match[2] ?? "",
	);
}

/** The keys of an emitted `export type XInput = Simplify<...>`, which is how the contract names one. */
function inputKeys(source: string, operationId: string): string[] {
	const name = `${operationId.charAt(0).toUpperCase()}${operationId.slice(1)}Input`;
	const declaration = new RegExp(`export type ${name} = Simplify<([\\s\\S]*?)>;`, "m").exec(source);
	if (declaration === null) return [];
	return [...(declaration[1] ?? "").matchAll(/^\t(?:"([^"]+)"|([A-Za-z_$][\w$]*))\??:/gm)].map(
		(match) => match[1] ?? match[2] ?? "",
	);
}

describe("the validators and the contract types name one operation's input the same way", () => {
	let compiled: CompiledFixture;
	let schemas = "";
	let requests = "";

	beforeAll(async () => {
		compiled = await compileFixture(here, "agreement");
		schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
		requests = readFileSync(join(compiled.outDir, "requests.gen.ts"), "utf8");
	}, 120_000);

	it("emits both artefacts, without which the arms below compare nothing", () => {
		expect(compiled.diagnostics).toEqual([]);
		// Non-vacuity: an unset `contracts-output-dir` is exactly how this gap survived.
		expect(requests).toContain("Input = Simplify<");
		expect(schemas).toContain("z.object({");
	});

	it("names every parameter the same way in both", () => {
		const operations = [...requests.matchAll(/export type (\w+)Input = Simplify</g)].map(
			(match) => `${(match[1] ?? "").charAt(0).toLowerCase()}${(match[1] ?? "").slice(1)}`,
		);
		// Non-vacuity: a regex that stops matching reports perfect agreement about nothing.
		expect(operations.length).toBeGreaterThanOrEqual(3);

		const disagreements: string[] = [];
		for (const operationId of operations) {
			const declared = new Set(inputKeys(requests, operationId));
			for (const suffix of ["Path", "Query", "Header"]) {
				for (const key of validatorKeys(schemas, `${operationId}${suffix}`)) {
					if (!declared.has(key)) {
						disagreements.push(`${operationId}.${suffix}: validator has "${key}", type does not`);
					}
				}
			}
		}
		expect(disagreements.toSorted()).toEqual([]);
	});

	it("types a raw binary body as bytes, not as text", () => {
		/**
		 * The document publishes `application/octet-stream` with `format: binary` for a `bytes` body,
		 * and the server hands the handler the bytes. Typing them `string` is the request half of the
		 * corruption already fixed on the reader: decoding raw bytes as text replaces every byte
		 * outside ASCII.
		 */
		const raw = /export type RawBytesInput = Simplify<([\s\S]*?)>;/m.exec(requests)?.[1] ?? "";
		expect(raw).not.toBe("");
		expect(raw).toContain("ArrayBuffer");
		expect(raw).not.toMatch(/body\??: string/);
	});
});
