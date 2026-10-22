import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllHttpServices } from "@typespec/http";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { collectRoutes } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/** **A media type is compared by its essence, wherever it is compared.** See `essence.tsp`. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, ZodType>;

beforeAll(async () => {
	compiled = await compileFixture(here, "essence");
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
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

describe("a body declared under a parametered JSON media type is JSON", () => {
	it("compiles with no diagnostic", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	it("places the body as a JSON body is placed: merged, validated, not raw text", () => {
		const [services] = getAllHttpServices(compiled.program);
		const service = services[0];
		if (service === undefined) throw new Error("fixture declares no service");
		const routes = collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service);
		for (const id of ["withCharset", "inCapitals", "plain"]) {
			const route = routes.find((candidate) => candidate.operationId === id);
			expect(route?.rawBodyProperty, id).toBeUndefined();
			expect(route?.bodyProperty, id).toBeUndefined();
			expect(route?.requestSchema, id).toBeDefined();
		}
	});

	it("states the model in the contract types, in both directions", () => {
		const { output, failed } =
			withConsumer(`import type { Produced, Thing, WireInputs, WireOutputs } from "./requests.gen.js";
type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;
export type Input = MustHold<Identical<WireInputs["withCharset"], { id: string; "Content-Type": "application/json; charset=utf-8" }>>;
export type Output = MustHold<Identical<WireOutputs["withCharset"], Produced<Thing>>>;
`);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});

describe("the Content-Type validator compares essences, and hands over the declared value", () => {
	const parse = (schema: string, value: string) =>
		schemas[schema]?.safeParse({ "Content-Type": value }) as
			| { success: boolean; data?: Record<string, unknown> }
			| undefined;

	it("accepts any spelling of the declared type, and yields the type as declared", () => {
		for (const sent of [
			"application/json; charset=utf-8",
			"application/json",
			"APPLICATION/JSON;charset=UTF-8",
		]) {
			const result = parse("withCharsetHeader", sent);
			expect(result?.success, sent).toBe(true);
			expect(result?.data?.["Content-Type"], sent).toBe("application/json; charset=utf-8");
		}
		const capitals = parse("inCapitalsHeader", "application/json");
		expect(capitals?.success).toBe(true);
		expect(capitals?.data?.["Content-Type"]).toBe("Application/JSON");
	});

	it("refuses another media type", () => {
		expect(parse("withCharsetHeader", "text/plain")?.success).toBe(false);
		expect(parse("inCapitalsHeader", "text/plain")?.success).toBe(false);
	});

	it("leaves a plainly declared type's validator as it was", () => {
		expect(parse("plainHeader", "application/json; charset=utf-8")?.data?.["Content-Type"]).toBe(
			"application/json",
		);
		expect(parse("plainHeader", "text/plain")?.success).toBe(false);
	});
});
