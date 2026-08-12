import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Every call in the generated Zod must be derivable from the document.**
 *
 * ⚠️ **This is the assertion the governing rule always claimed and did not have — twice.** "Nothing
 * in the runtime validator is unsayable in the document" sat in the original emitter's plan for its
 * entire life, cited constantly, never built. It was eventually built there; then this package was
 * extracted without it, and the README went on claiming the class was asserted rather than trusted.
 *
 * That is the worst arrangement available: a rule everybody cites, nothing checks, and which
 * therefore drifts exactly as far as attention lapses. It matters more now, not less —
 * `z.preprocess` is admitted for collection formats, and an unenforced rule with a fresh exception
 * is how a dialect starts.
 *
 * **The class, not a list of members.** Anything that computes rather than describes is refused,
 * with one carve-out, stated as a SHAPE a machine can check rather than as a file name.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** Zod calls that enforce or rewrite something JSON Schema cannot state. */
const NOT_DERIVABLE = /\.(refine|superRefine|transform|catch|pipe|brand)\(/g;

/**
 * The ONE permitted `z.preprocess`, written as the only shape it may take.
 *
 * OpenAPI's `style` says a list was flattened into one value with a delimiter; this undoes exactly
 * that, before validation, so the document's own constraints still run. A `preprocess` doing anything
 * else — coercing, defaulting, renaming — is refused, because the document does not say it.
 */
const DELIMITER_SPLIT =
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? raw\.split\("(?:[^"\\]|\\.)*"\) : raw\), /g;

/** Emitted output, wherever a suite has produced it. */
function emittedFiles(): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry.endsWith(".gen.ts")) found.push(full);
		}
	};
	walk(join(packageRoot, "test"));
	return found;
}

describe("the generated validator says only what the document can say", () => {
	const files = emittedFiles();

	it("has emitted output to inspect at all", () => {
		// Without this the whole file passes the day the suites stop writing `.out/`.
		expect(files.length).toBeGreaterThanOrEqual(20);
	});

	it("uses no Zod call that enforces something the document cannot state", () => {
		/**
		 * Empty, not a count. An allowance that survives the thing it allowed has stopped guarding
		 * anything — which is why the original wrote this as a number first: reaching zero had to fail
		 * here rather than pass quietly.
		 */
		const offenders = files.flatMap((file) => {
			const source = readFileSync(file, "utf8");
			return [...source.matchAll(NOT_DERIVABLE)].map((match) => `${match[1]} in ${file}`);
		});
		expect(offenders).toEqual([]);
	});

	it("permits `z.preprocess` only as a delimiter split", () => {
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			const all = (source.match(/z\.preprocess\(/g) ?? []).length;
			const splits = (source.match(DELIMITER_SPLIT) ?? []).length;
			expect(all, `a non-split z.preprocess in ${file}`).toBe(splits);
		}
	});

	it("finds the delimiter splits it is meant to permit", () => {
		// Paired with the arm above, which passes trivially if the emitter stops emitting any.
		const splits = files.reduce(
			(total, file) => total + (readFileSync(file, "utf8").match(DELIMITER_SPLIT) ?? []).length,
			0,
		);
		expect(splits).toBeGreaterThanOrEqual(5);
	});

	it("enforces no `format`, which is a DECISION and is now checked rather than counted", () => {
		/**
		 * ⚠️ **The document's `format` is an annotation, not an assertion** — JSON Schema 2020-12 says
		 * so — and a validator that turns one into a check enforces something the contract does not
		 * state. That is the governing rule, and the emitter's compliance with it was a *number*: 133
		 * annotations counted as unenforced, which says what did not happen rather than what may not.
		 *
		 * A number cannot fail. This can: any Zod call that derives a check from a format is refused as
		 * a class, so the decision holds by construction instead of by whoever reads the baseline next.
		 *
		 * ⚠️ **Not an argument that `format` should never be enforced.** It is an argument that turning
		 * it on is a deliberate change to what this package claims, and should break a test rather than
		 * move a counter.
		 */
		const FORMAT_ASSERTIONS =
			/\.(email|url|uuid|uuidv4|uuidv7|cuid|cuid2|ulid|emoji|base64|base64url|nanoid|jwt|ipv4|ipv6|cidrv4|cidrv6|e164|datetime|date|time|duration)\(|z\.iso\./g;
		const offenders = files.flatMap((file) =>
			[...readFileSync(file, "utf8").matchAll(FORMAT_ASSERTIONS)].map(
				(match) => `${match[0]} in ${file}`,
			),
		);
		expect(offenders).toEqual([]);
	});

	it("ships no decorator of its own for a spec to depend on", () => {
		/**
		 * ⚠️ **The other half, and without it the arm above can be satisfied by a spec that simply
		 * stopped using the decorator.** Four existed in this emitter's ancestor — `@trimmed`, `@loose`,
		 * `@externalValues`, `@refine` — and each let a spec state something `@typespec/openapi3` could
		 * not publish, so the emitted validator enforced a rule no caller reading the contract could see.
		 *
		 * Asserted against the package's own TypeSpec entry point, because that is the only thing a
		 * consumer's `import` can reach. A `$decorators` export there is a second contract, whatever it
		 * happens to contain.
		 */
		const entry = readFileSync(join(packageRoot, "lib", "main.tsp"), "utf8");
		expect(entry).not.toMatch(/^\s*import\s+"\.\/decorators\.tsp"/m);
		// The DECLARATION, not the word: the docblock beside it explains why there is none, and a
		// prose match would make this arm impossible to satisfy while explaining itself.
		expect(readFileSync(join(packageRoot, "src", "tsp-index.ts"), "utf8")).not.toMatch(
			/^\s*(?:export\s+)?const\s+\$decorators\b/m,
		);
		expect(existsSync(join(packageRoot, "lib", "decorators.tsp"))).toBe(false);
		// `$lib` carries no `state` key either: state is what a decorator writes into.
		expect(readFileSync(join(packageRoot, "src", "lib.ts"), "utf8")).not.toMatch(/^\s*state:/m);
	});
});
