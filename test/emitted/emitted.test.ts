import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, type EmitContext, NodeHost } from "@typespec/compiler";
import { beforeAll, describe, expect, it } from "vitest";
import { emitHttpZod, type EmittedService } from "../../src/index.js";
import { compileFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/** **What `EmittedService` publishes, graded where it is produced.** See `emitted.tsp`. */

const here = fileURLToPath(new URL(".", import.meta.url));

/** Timings are reported nowhere: the records are what this suite reads. */
const perf: EmitContext["perf"] = {
	startTimer: () => ({ end: () => 0 }),
	time: (_label, callback) => callback(),
	timeAsync: (_label, callback) => callback(),
	report: () => {},
};

let service: EmittedService;

beforeAll(async () => {
	// `noEmit`: the records are returned, and nothing is written.
	const program = await compile(NodeHost, join(here, "emitted.tsp"), { noEmit: true });
	const [only] = await emitHttpZod({
		program,
		emitterOutputDir: join(here, ".out", "records"),
		options: {},
		perf,
	});
	if (only === undefined) throw new Error("the fixture declares a service");
	service = only;
}, 120_000);

describe("each route's operation, and the accept a negotiated one is chosen by", () => {
	it("maps every operation id to the operation it was collected from, shared routes included", () => {
		const names = service.routes.map((route) => [
			route.operationId,
			service.operations.get(route.operationId)?.operation.name,
		]);
		expect(names.toSorted()).toEqual([
			["issue", "issue"],
			["reportAsJson", "reportAsJson"],
			["reportAsText", "reportAsText"],
			["status", "status"],
		]);
	});

	it("gives each member of a shared route its own accept literal, and an unshared route none", () => {
		const selected = (id: string) => service.schemaNames.get(id)?.selectedAccept;
		expect(selected("reportAsText")).toEqual({ name: "accept", value: "text/plain" });
		expect(selected("reportAsJson")).toEqual({ name: "accept", value: "application/json" });
		// Validated by its header schema, so nothing is left for a server emitter to supply.
		expect(selected("status")).toBeUndefined();
	});
});

describe("a model only ever sent is paired with its validator", () => {
	/**
	 * **The pairing has to fail the build when the two drift**, and a model a response alone names is
	 * the case it used to skip. The control plants the drift in the emitted contract type and
	 * requires the compile to refuse it at that model's assertion.
	 */
	it("compiles as emitted, and refuses a drift planted in a response-only model", async () => {
		const compiled = await compileFixture(here, "emitted");
		expect(compiled.diagnostics).toEqual([]);
		const pairing = readFileSync(join(compiled.outDir, "wire-contract.gen.ts"), "utf8");
		expect(pairing).toMatch(/^export type AssertReceipt = /m);
		const clean = typecheckEmitted(compiled.outDir);
		expect(clean.output).toBe("");
		expect(clean.failed).toBe(false);

		const contracts = join(compiled.outDir, "requests.gen.ts");
		const original = readFileSync(contracts, "utf8");
		const planted = original.replace(
			"export interface Receipt {",
			"export interface Receipt {\n\tplanted: string;",
		);
		expect(planted).not.toBe(original);
		writeFileSync(contracts, planted);
		try {
			const drifted = typecheckEmitted(compiled.outDir);
			expect(drifted.failed).toBe(true);
			expect(drifted.output).toMatch(/wire-contract\.gen\.ts\(\d+,\d+\): error TS2344/);
		} finally {
			writeFileSync(contracts, original);
		}
	}, 120_000);
});
