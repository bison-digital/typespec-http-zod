import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/** See `envelope.tsp`. Both claims are about what a handler can actually say. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: string;

beforeAll(async () => {
	compiled = await compileFixture(here, "envelope", { outName: "envelope" });
	schemas = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
}, 300_000);

const armsOf = (operationId: string): string =>
	new RegExp(`export const ${operationId}Responses = (.*)`).exec(schemas)?.[1] ?? "";

describe("every success status the document declares gets an arm", () => {
	it("emits the arm lists this suite reads", () => {
		// Non-vacuity: every assertion below reads one of these.
		for (const id of ["create", "tagged", "plain"]) {
			expect(armsOf(id), `no arms found for ${id}`).not.toBe("");
		}
	});

	/**
	 * **`armFor` cannot select an arm that was never written.** The document publishes 200 and 201;
	 * one arm was emitted, so a route answering 201 on create and 200 on update had no way to say so.
	 */
	it("emits one arm per declared success status", () => {
		const arms = armsOf("create");
		expect(arms).toContain("status: 200");
		expect(arms).toContain("status: 201");
	});

	/**
	 * **The `@statusCode` union IS the selector.** The handler says which status it means by setting
	 * that property, so nothing is inferred from the body's shape - which is what
	 * `statusDiscriminatorOf` had to do, and why it needed a required literal that almost no spec has.
	 */
	it("keys the non-default arm on the status property the spec declares", () => {
		expect(armsOf("create")).toMatch(/when: \{ property: "statusCode", value: 201 \}/);
	});

	it("leaves a single-status operation exactly as it was", () => {
		const arms = armsOf("plain");
		expect(arms).toContain("status: 200");
		expect(arms).not.toContain("when:");
		expect(arms).not.toContain("status: 201");
	});
});

describe("the emitted arms compile", () => {
	/**
	 * **`satisfies readonly ResponseArm[]` is what makes this more than a text assertion.** A numeric
	 * selector value against a `boolean | string` field is a compile error in the file the emitter
	 * just wrote, and no arm reading the text would see it.
	 */
	it("passes tsc, selector values included", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});
});

/**
 * **An arm names the property a header value is read from, and the handler has to be able to set
 * it.** `@header` properties are stripped from the body schema, correctly - they are not body - so
 * the type a handler returns did not carry them. Measured on `payload__head`:
 * `Awaitable<Result<void>>` against an arm naming two header properties.
 *
 * The library's half is publishing the property's TYPE alongside its name, so the server emitter can
 * put it in the signature rather than guessing `string`.
 */
describe("a response header is something the handler can supply", () => {
	it("publishes the header property with its type, not just its name", () => {
		const arms = armsOf("tagged");
		expect(arms).toContain('name: "x-correlation-id"');
		expect(arms).toContain('property: "correlationId"');
	});
});
