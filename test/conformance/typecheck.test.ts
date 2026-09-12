import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	compileScenario,
	depthSources,
	discoverScenarios,
	type CompiledScenario,
} from "./corpus.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **The emitted output of the whole corpus, put through `tsc`.**
 *
 * `wire-contract.gen.ts` is the only thing that catches this emitter disagreeing with ITSELF: it
 * pairs what the validator accepts against the framework-free contract type, by name. It was written
 * for every corpus scenario and compiled for none, so the assertion existed roughly 41 times over and
 * held nowhere.
 *
 * Measured the first time it was run: **41 of the 41 scenarios carrying a wire contract failed**,
 * every one of them because the harness pointed `contracts-package` at `vocabularies.gen.js` - a trap
 * `test/support/compile-fixture.ts` had already written down and this harness walked into. With a
 * barrel instead, three real emitter defects were left, all of which had been shipping:
 *
 * - a vocabulary alias was emitted WITHOUT `export`, so a barrel could not re-export it and no spec
 *   with an enum request body could compile its wire contract;
 * - `z.strictObject({})` infers `Record<string, never>` while this walk emits `{}`, so an empty model
 *   compared unequal to itself;
 * - `TypeRegistry` emits one declaration per model name carrying the canonical property set, while
 *   `SchemaRegistry` emits a visibility-projected one per position. The last is still open, and is
 *   baselined below with its reason.
 *
 * Its own out root, because `test/isolation.test.ts` requires one per suite: three oracles once
 * graded whatever the previous run had left behind.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const outRoot = join(here, ".out-typecheck");

/**
 * Scenarios whose emitted output is known not to compile, each with the reason.
 *
 * **A baseline, not an exclusion list, and it is read in both directions.** An entry that starts
 * compiling is a fix nobody recorded, and fails this suite until the entry is deleted - the same rule
 * `differential.test.ts` applies to its own baseline, for the same reason.
 */
const KNOWN_UNCOMPILABLE: Readonly<Record<string, string>> = {
	"type/model/visibility":
		"TypeRegistry emits ONE declaration per model name, carrying the canonical property set, and uses " +
		"it for every operation. SchemaRegistry emits a visibility-projected schema per position, so the " +
		"Read schema declares readProp alone while the contract type declares all six properties. Fixing " +
		"it means giving TypeRegistry the visibility keying and suffixes SchemaRegistry already has, " +
		"which RENAMES published contract types for any spec using @visibility.",
};

interface Checked {
	readonly name: string;
	readonly output: string;
}

let compiled: readonly CompiledScenario[] = [];
let checked: readonly Checked[] = [];

beforeAll(async () => {
	const results: CompiledScenario[] = [];
	for (const scenario of [...discoverScenarios(), ...depthSources()]) {
		try {
			results.push(await compileScenario(scenario, outRoot));
		} catch {
			// A harness crash is reported by `differential.test.ts`, which owns that claim.
		}
	}
	compiled = results;
	/**
	 * **Only a scenario that compiled CLEAN is typechecked, and the predicate is the compile result
	 * rather than a name.** A spec this emitter refuses emits deliberately unusable output - a refused
	 * discriminated union emits `z.never()` on one side and a union on the other - so requiring it to
	 * typecheck would be requiring the refusal not to have happened.
	 */
	checked = compiled
		.filter((result) => result.failure === undefined)
		.map((result) => ({
			name: result.scenario.name,
			output: typecheckEmitted(result.zodDir).output,
		}));
}, 1_800_000);

describe("every scenario's emitted output compiles", () => {
	it("typechecked enough scenarios to mean something", () => {
		// Floors, not pins. Without them the day `compileScenario` starts failing everything, this suite
		// passes having compiled nothing at all.
		expect(checked.length).toBeGreaterThanOrEqual(60);
		expect(checked.filter((result) => result.output === "").length).toBeGreaterThanOrEqual(55);
	});

	it("refuses no more scenarios than the baseline records", () => {
		// A ceiling rather than silence: scenarios excluded because the emitter refused them are a real
		// and small set, and the day it grows this says so.
		expect(compiled.filter((result) => result.failure !== undefined).length).toBeLessThanOrEqual(4);
	});

	it("compiles every scenario the baseline does not name", () => {
		const failing = checked
			.filter((result) => result.output !== "")
			.map((result) => result.name)
			.toSorted();
		expect(failing.filter((name) => KNOWN_UNCOMPILABLE[name] === undefined)).toEqual([]);
	});

	it("names no scenario in the baseline that now compiles", () => {
		// The other direction. A fix that leaves its baseline entry behind makes the file stop meaning
		// anything, and the next reader trusts it.
		const stillFailing = new Set(
			checked.filter((result) => result.output !== "").map((result) => result.name),
		);
		expect(Object.keys(KNOWN_UNCOMPILABLE).filter((name) => !stillFailing.has(name))).toEqual([]);
	});
});
