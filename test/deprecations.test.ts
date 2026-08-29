/**
 * **The emitted output uses no Zod API that Zod itself has retired.**
 *
 * `vocabulary.test.ts` asks whether a construct is DERIVABLE from the document - whether the emitter
 * is entitled to write it at all. This asks a different question: of the constructs it is entitled
 * to write, is it writing the ones Zod still recommends? A validator can be perfectly derivable and
 * still be spelled in a way the library moved on from two minors ago.
 *
 * **The list is read out of the installed Zod, never written down here.** A hand-kept list of
 * deprecated APIs is a list that stops covering what the library has retired, and it would go stale
 * silently - the exact failure this file exists to prevent, one level up. Zod marks retirements with
 * `@deprecated` in its shipped type definitions, so the set arrives with the dependency and moves
 * when it moves. The day Zod deprecates something this emitter writes, this arm goes red on the
 * upgrade rather than on a consumer's review.
 *
 * **Only `classic/schemas.d.cts`**, which is where the schema METHODS live. The other files carry
 * deprecations on error formatters, internals (`_def`) and introspection - real, but not things an
 * emitter writes into a validator.
 *
 * **The receiver decides, not the name.** `.url()` on a string is retired; `z.url()` is the current
 * spelling of the same check, and `z.iso.datetime()` likewise. They share a name, so matching on the
 * name alone would condemn exactly the output this emitter is right to produce - measured: 165 such
 * hits across the corpus, every one of them a namespace call. So namespace calls are removed first
 * and what remains is a method call on a schema.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compileEmittedSet } from "./support/emitted-set.js";

const packageRoot = join(import.meta.dirname, "..");

/** Names Zod marks `@deprecated` on its classic schema classes, read from the installed copy. */
function retiredMethods(): readonly string[] {
	const file = join(packageRoot, "node_modules/zod/v4/classic/schemas.d.cts");
	const source = readFileSync(file, "utf8");
	// The name FOLLOWS the JSDoc block. Reading the line before it instead finds the previous member,
	// which is how a first attempt at this produced a list of things Zod recommends.
	const declaration =
		/\/\*\*(?:(?!\*\/)[\s\S])*?@deprecated(?:(?!\*\/)[\s\S])*?\*\/\s*([A-Za-z_$][\w$]*)/g;
	const names = new Set<string>();
	for (const match of source.matchAll(declaration)) {
		const name = match[1];
		// `export` is the keyword after a block comment, not a member; internals are not emitted.
		if (name === undefined || name === "export" || name.startsWith("_")) continue;
		names.add(name);
	}
	return [...names].toSorted();
}

let emitted: readonly { readonly file: string; readonly source: string }[] = [];

beforeAll(async () => {
	const files = await compileEmittedSet("deprecations");
	emitted = files.map((file) => ({ file, source: readFileSync(file, "utf8") }));
}, 900_000);

describe("the emitted validators use no retired Zod API", () => {
	it("read the retirement list out of Zod, and it is not empty", () => {
		/**
		 * **Without this the whole file passes by accident.** An extraction that matched nothing - a
		 * renamed path, a change in how Zod ships its types - would leave every arm below comparing
		 * against an empty set and reporting perfect health. Floored well below the count observed at
		 * zod 4.5.2 (35) so an ordinary retirement or two does not fail it.
		 */
		expect(retiredMethods().length).toBeGreaterThanOrEqual(20);
		// Two Zod has genuinely retired, as a shape check on the extraction rather than a list to keep.
		expect(retiredMethods()).toContain("merge");
		expect(retiredMethods()).toContain("passthrough");
	});

	it("has emitted output to inspect at all", () => {
		expect(emitted.length).toBeGreaterThanOrEqual(100);
	});

	it("calls no retired METHOD, while still using the namespace forms that share their names", () => {
		const retired = retiredMethods();
		const method = new RegExp(`\\.(${retired.join("|")})\\(`, "g");
		const namespaceCall = /\bz\.(?:iso\.|coerce\.)?[A-Za-z0-9_]+\(/g;
		/**
		 * **A JavaScript built-in is not a Zod schema, and one of them shares a retired name.**
		 *
		 * The wire decoder this emitter writes for a numeric parameter calls `Number.isFinite(...)`,
		 * and `isFinite` is retired on `ZodNumber`. Matching on the name alone flagged seven emitted
		 * files for a call that has nothing to do with Zod. The receiver is what decides, so the
		 * globals are removed alongside the namespace calls.
		 */
		const builtinCall =
			/\b(?:Number|Array|Object|String|JSON|Math|Date|Boolean|Symbol)\.[A-Za-z0-9_]+\(/g;

		let namespaced = 0;
		const offenders: string[] = [];
		for (const { file, source } of emitted) {
			namespaced += [...source.matchAll(namespaceCall)].length;
			const receiverless = source.replace(namespaceCall, "NS(").replace(builtinCall, "BUILTIN(");
			for (const match of receiverless.matchAll(method)) {
				offenders.push(`${file.slice(packageRoot.length + 1)}: .${match[1]}()`);
			}
		}
		// Non-vacuity from the other side: if the emitter stopped writing `z.url()` and friends this
		// would pass while grading almost nothing, so the namespace calls are floored too.
		expect(namespaced).toBeGreaterThanOrEqual(100);
		expect([...new Set(offenders)].toSorted()).toEqual([]);
	});
});
