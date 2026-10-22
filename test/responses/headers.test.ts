import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllHttpServices } from "@typespec/http";
import { beforeAll, describe, expect, it } from "vitest";
import { collectRoutes, type EmittedRoute } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A response header's TYPE and its SCHEMA describe one value.** See `headers.tsp`.
 *
 * The type is what a server emitter puts in a handler's result; the schema is what it checks the
 * value against before sending it. Compiled, one assertion per header the fixture declares, each
 * comparing the published type with the input of the header schema emitted for the same status.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let routes: readonly EmittedRoute[];
let exports: readonly string[];

beforeAll(async () => {
	compiled = await compileFixture(here, "headers", { outName: "response-headers" });
	const [services] = getAllHttpServices(compiled.program);
	const service = services[0];
	if (service === undefined) throw new Error("fixture declares no service");
	routes = collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service);
	exports = Object.keys(
		(await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, unknown>,
	);
}, 300_000);

describe("a response header's published type", () => {
	it("is the type its own header schema accepts, for every header declared", () => {
		const assertions: string[] = [];
		const schemas = new Set<string>();
		for (const route of routes) {
			for (const response of route.responses) {
				if (response.headers.length === 0) continue;
				const schema = `${route.operationId}Response${String(response.status)}Headers`;
				expect(exports, `${schema} was not emitted`).toContain(schema);
				schemas.add(schema);
				for (const header of response.headers) {
					assertions.push(
						`export type ${header.name.replaceAll(/[^A-Za-z0-9]/g, "_")}Agrees = MustHold<Identical<${header.type}, Exclude<z.input<typeof ${schema}>[${JSON.stringify(header.name)}], undefined>>>;`,
					);
				}
			}
		}
		// Non-vacuity: the fixture declares six headers on one status.
		expect(assertions).toHaveLength(6);
		const file = join(compiled.outDir, "headers.consumer.ts");
		writeFileSync(
			file,
			`import type { z } from "zod";
import type { ${[...schemas].join(", ")} } from "./schemas.gen.js";

type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;

${assertions.join("\n")}
`,
		);
		try {
			const { output, failed } = typecheckEmitted(compiled.outDir);
			expect(output).toBe("");
			expect(failed).toBe(false);
		} finally {
			rmSync(file, { force: true });
		}
	});
});
