import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { z, type ZodType } from "zod";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/** See `inheritednames.tsp`. Issues #5 and #6. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;
let source: string;

beforeAll(async () => {
	compiled = await compileFixture(here, "inheritednames", { outName: "inheritednames" });
	source = readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8");
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
}, 300_000);

/** `code -> the property names it was reported on`, read off the program so the target is known. */
function reported(code: string): readonly string[] {
	return compiled.program.diagnostics
		.filter((diagnostic) => diagnostic.code === `typespec-http-zod/${code}`)
		.map((diagnostic) => {
			const target = diagnostic.target as { readonly kind?: string; readonly name?: string };
			return `${target.kind}:${target.name}`;
		})
		.toSorted();
}

describe("an optional property named after an Object.prototype member (#5)", () => {
	it("is reported once per property it bites, as a warning", () => {
		expect(reported("optional-prototype-name")).toEqual([
			"ModelProperty:constructor",
			"ModelProperty:constructor",
			"ModelProperty:hasOwnProperty",
			"ModelProperty:renamed",
			"ModelProperty:toString",
			"ModelProperty:valueOf",
		]);
		expect(
			compiled.diagnostics
				.filter((diagnostic) => diagnostic.code.endsWith("optional-prototype-name"))
				.every((diagnostic) => diagnostic.severity === "warning"),
		).toBe(true);
	});

	it("reports nothing else, the controls included", () => {
		const codes = new Set(compiled.diagnostics.map((diagnostic) => diagnostic.code));
		expect([...codes].toSorted()).toEqual([
			"typespec-http-zod/optional-prototype-name",
			"typespec-http-zod/unenforceable-property-name",
		]);
	});

	/**
	 * **The pin.** This is the Zod defect itself, through the emitted validator. When it goes red,
	 * colinhacks/zod#6666 is fixed: raise the `zod` peer floor to the release that fixed it, and
	 * retire `optional-prototype-name`, which then reports a problem that no longer exists.
	 */
	it("still refuses a body that leaves the property out, because Zod reads the inherited one", () => {
		const widget = schemas["widgetSchema"] as ZodType;
		expect(widget.safeParse({ id: "w", hasOwnProperty: "x" }).success).toBe(false);
		expect(
			widget.safeParse({
				id: "w",
				hasOwnProperty: "x",
				constructor: "c",
				toString: "t",
				valueOf: 2,
				isPrototypeOf: "i",
			}).success,
		).toBe(true);
	});
});

describe("a property named __proto__ (#6)", () => {
	it("is reported, once, as a warning", () => {
		expect(reported("unenforceable-property-name")).toEqual(["ModelProperty:__proto__"]);
	});

	it("is declared as a key, not written as the shape's prototype", () => {
		expect(source).toContain('\t["__proto__"]: z.string(),');
		expect(
			Object.keys((schemas["prototypedSchema"] as unknown as { shape: object }).shape),
		).toEqual(["id", "__proto__"]);
	});

	it("publishes the property the document publishes", () => {
		const json = z.toJSONSchema(schemas["prototypedSchema"] as ZodType, { io: "input" }) as {
			properties?: Record<string, unknown>;
			required?: readonly string[];
		};
		expect(Object.keys(json.properties ?? {})).toEqual(["id", "__proto__"]);
		expect(json.required).toEqual(["id", "__proto__"]);
	});

	it("no longer refuses a sealed body for carrying it, which the literal key did", () => {
		const body = JSON.parse('{"id":"w","__proto__":"x"}') as unknown;
		expect((schemas["prototypedSchema"] as ZodType).safeParse(body).success).toBe(true);
	});

	it("typechecks, the contract types included", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
