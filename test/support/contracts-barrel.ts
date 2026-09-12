import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The contracts package a compiled fixture imports its shared types from.
 *
 * **A suite that compiles emitted output needs one, and pointing `contracts-package` at
 * `vocabularies.gen.js` instead is a trap that looks fine until it is compiled.**
 * `wire-contract.gen.ts` names request types as well as vocabularies, so under that setting it
 * references members the module does not export: `TS2694` per model and, downstream of each, an
 * identity assertion failing for a reason that has nothing to do with the shapes.
 *
 * A real consumer's contracts package is a barrel over both artefacts. So is this.
 *
 * **Written here rather than in each harness, because the trap was documented in one of them and
 * walked into by the other.** `compile-fixture.ts` carried this paragraph and got it right; the
 * corpus harness set `vocabularies.gen.js` and got it wrong, and nothing noticed because nothing
 * compiled corpus output. One spelling, so a third harness cannot re-enter it.
 */
export const CONTRACTS_BARREL = "contracts.barrel";

/** The specifier a compiled fixture's `contracts-package` should be set to. */
export const CONTRACTS_BARREL_SPECIFIER = `./${CONTRACTS_BARREL}.js`;

/** Write the barrel beside emitted output. */
export function writeContractsBarrel(outDir: string): void {
	writeFileSync(
		join(outDir, `${CONTRACTS_BARREL}.ts`),
		[
			"// The contracts package, as a consumer's would be: one specifier over both artefacts.",
			'export * from "./requests.gen.js";',
			'export * from "./vocabularies.gen.js";',
			"",
		].join("\n"),
	);
}
