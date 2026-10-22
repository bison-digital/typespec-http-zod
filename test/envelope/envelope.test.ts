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
	 * **No arm names a property to choose it by.** A handler names the status it answers with, and
	 * `armFor` resolves the arm. A `when` selector keyed on the `@statusCode` property's TypeSpec name
	 * used to be emitted here, which put a name the document never publishes into the contract.
	 */
	it("gives each declared status its own arm, with no selector", () => {
		const arms = armsOf("create");
		expect(arms).not.toContain("when:");
		expect(arms).toMatch(/\{ status: 200, schema: itemSchema/);
		expect(arms).toMatch(/\{ status: 201, schema: itemSchema/);
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
	 * **`satisfies readonly ResponseArm[]` is what makes this more than a text assertion.** An arm
	 * field the runtime type does not declare is a compile error in the file the emitter just wrote,
	 * and no arm reading the text would see it.
	 */
	it("passes tsc", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});
});

/**
 * **A response header is published by the wire name the response sets.** The handler supplies it
 * under that name, and the library also publishes its TypeScript type on the route so a server
 * emitter can put it in the signature rather than guessing `string`.
 */
describe("a response header is something the handler can supply", () => {
	it("publishes the header by its wire name, not its property name", () => {
		const arms = armsOf("tagged");
		expect(arms).toContain('{ name: "x-correlation-id", optional: false }');
		expect(arms).not.toContain("correlationId");
	});
});
