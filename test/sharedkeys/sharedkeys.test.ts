import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllHttpServices } from "@typespec/http";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { collectRoutes, type EmittedRoute } from "../../src/index.js";
import { SchemaRegistry } from "../../src/registry.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Two inputs a handler would be handed under one key are reported, and stated as both at once.**
 * See `sharedkeys.tsp`.
 *
 * A handler's input spreads the path, query, header and cookie groups into one object, so
 * `@header("x")` beside `@query("x")` reached it as one `x` - the header's string replacing the
 * validated number - with no diagnostic. The contract types were worse off: `WireInputs` wrote both
 * as members of one object literal, which does not compile.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let routes: readonly EmittedRoute[];
let schemas: Record<string, ZodType>;

beforeAll(async () => {
	compiled = await compileFixture(here, "sharedkeys", { outName: "sharedkeys" });
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, ZodType>;
	const [[service]] = getAllHttpServices(compiled.program);
	if (service === undefined) throw new Error("no service");
	routes = collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service);
}, 300_000);

/** operation, the key, the location declared first, the location declared second. */
const PAIRS: readonly (readonly [string, string, string, string])[] = [
	["headerQuery", "x", "header", "query"],
	["queryQuery", "x", "query", "query"],
	["queryQueryAgreeing", "y", "query", "query"],
	["pathHeader", "id", "path", "header"],
	["cookieQuery", "session", "cookie", "query"],
	["queryBody", "body", "query", "body"],
];

const NOUNS: Record<string, string> = {
	path: "path parameter",
	query: "query parameter",
	header: "header",
	cookie: "cookie",
	body: "body",
};

describe("two inputs under one key", () => {
	it("is reported once per operation, as a warning, and nothing else is", () => {
		expect(compiled.diagnostics).toEqual(
			PAIRS.map(() => ({ code: "typespec-http-zod/shared-input-key", severity: "warning" })),
		);
	});

	for (const [operation, key, first, second] of PAIRS) {
		it(`${operation}: names the ${first} and the ${second} '${key}'`, () => {
			const message = compiled.program.diagnostics.find((d) =>
				d.message.startsWith(`'${operation}' `),
			)?.message;
			// One location carries one value, which the document publishes as the first declaration.
			expect(message).toContain(
				first === second
					? `the ${NOUNS[first]} '${key}' twice, and the document publishes only the first`
					: `the ${NOUNS[first]} '${key}' and the ${NOUNS[second]} '${key}'`,
			);
			expect(routes.find((route) => route.operationId === operation)?.sharedInputKeys).toEqual([
				{ key, first, second },
			]);
		});
	}

	/**
	 * **Once per program, however many emitters run the library.** `typespec-hono` and
	 * `typespec-http-mcp` compiled together each collect the routes, and each collection is a fresh set
	 * of operations, so the warning was raised twice per pair. A second collection here stands for the
	 * second emitter. (The compile ran the built package and this suite runs the source, two module
	 * instances, so the count before is the compile's and `beforeAll`'s; what matters is that it does
	 * not grow.)
	 */
	it("is not reported again when a second emitter collects the same routes", () => {
		const count = () =>
			compiled.program.diagnostics.filter((d) => d.code === "typespec-http-zod/shared-input-key")
				.length;
		const before = count();
		const [[service]] = getAllHttpServices(compiled.program);
		if (service === undefined) throw new Error("no service");
		collectRoutes(compiled.program, new SchemaRegistry(compiled.program), service);
		expect(count()).toBe(before);
	});

	it("lists nothing for an operation whose inputs are all distinct", () => {
		expect(routes.find((route) => route.operationId === "control")?.sharedInputKeys).toEqual([]);
	});
});

describe("the key, stated as the declarations the document publishes", () => {
	it("validates one location's shared key as the first declaration, as the document publishes it", () => {
		expect(schemas["queryQueryAgreeingQuery"]?.safeParse({ y: "v" }).success).toBe(true);
		// Published as `x: string`, the first: both are valid, where intersected with `int32` neither was.
		expect(schemas["queryQueryQuery"]?.safeParse({ x: "1" }).success).toBe(true);
		expect(schemas["queryQueryQuery"]?.safeParse({ x: "a" }).success).toBe(true);
	});

	it("keeps each location's own validator for a key two locations share", () => {
		expect(schemas["headerQueryHeader"]?.safeParse({ x: "a" }).success).toBe(true);
		expect(schemas["headerQueryQuery"]?.safeParse({ x: "1" }).success).toBe(true);
	});

	it("types the input as both, in contract types that compile", () => {
		const file = join(compiled.outDir, "consumer.ts");
		writeFileSync(
			file,
			`import type { Thing, WireInputs } from "./requests.gen.js";

type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;
export type HeaderQuery = MustHold<Identical<WireInputs["headerQuery"], { x: never }>>;
export type QueryQuery = MustHold<Identical<WireInputs["queryQuery"], { x: string }>>;
export type Agreeing = MustHold<Identical<WireInputs["queryQueryAgreeing"], { y: string }>>;
export type PathHeader = MustHold<Identical<WireInputs["pathHeader"], { id: string }>>;
export type QueryBody = MustHold<Identical<WireInputs["queryBody"], { body: Thing[] & string }>>;
export type Control = MustHold<Identical<WireInputs["control"], { x: string; y: number }>>;
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
