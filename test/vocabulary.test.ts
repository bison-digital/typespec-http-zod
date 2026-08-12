import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileEmittedSet } from "./support/emitted-set.js";

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
 * The permitted `z.preprocess` shapes — each written as the only form it may take.
 *
 * Every one of these undoes a TRANSPORT ENCODING before validation, so the document's own schema and
 * every constraint on it still run afterwards. A `preprocess` doing anything else — coercing,
 * defaulting, renaming — is still refused, because the document does not say it.
 *
 * ⚠️ **The line between "decoding" and "coercing" is whether an invalid value can become valid.**
 * `z.coerce.number()` is the forbidden thing and it is one character of effort: `Number("")` is `0`,
 * so `?limit=` would satisfy a required integer that the document forbids. Every decoder below passes
 * a malformed value through UNCHANGED, so it fails against the published schema and reports the error
 * the document justifies. That is the property that makes them derivable; it is not a matter of taste.
 */

/** A list flattened into one value by OpenAPI's `style`/`explode`, split back apart. */
const DELIMITER_SPLIT =
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? raw\.split\("(?:[^"\\]|\\.)*"\) : raw\), /g;

/**
 * A path, query or header scalar decoded from the only thing HTTP can carry: text.
 *
 * ⚠️ **`type: integer` on a query parameter describes the DECODED value, not the wire.** Without this
 * the emitted `z.number().int()` met `"1"` and refused it — measured against a Petstore server under
 * `wrangler dev`, `GET /pet/1` answered 400 to every conformant caller while `GET /user/zach` answered
 * 200. Same class as the split above: the transport carries text, the document describes the value.
 */
const SCALAR_DECODE = [
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" && raw\.trim\(\) !== "" && Number\.isFinite\(Number\(raw\)\) \? Number\(raw\) : raw\), /g,
	/z\.preprocess\(\(raw\) => \(raw === "true" \? true : raw === "false" \? false : raw\), /g,
	/z\.preprocess\(\(raw\) => \(Array\.isArray\(raw\) \? raw\.map\(\(raw\) => \((?:typeof raw === "string" && raw\.trim\(\) !== "" && Number\.isFinite\(Number\(raw\)\) \? Number\(raw\) : raw|raw === "true" \? true : raw === "false" \? false : raw)\)\) : raw\), /g,
];

/**
 * A `content-type` header reduced to the media type, discarding the parameters the document does not
 * mention.
 *
 * ⚠️ **Refusing parameters is enforcing something the document cannot state**, and it made every
 * multipart request fail — the boundary parameter RFC 2046 requires is exactly what the literal
 * refused. Both spellings are permitted: the lowercasing one applies when the declared literal is
 * itself lowercase, which is every literal openapi3 publishes across this corpus.
 */
const MEDIA_TYPE_DECODE = [
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? \(raw\.split\(";"\)\[0\] \?\? ""\)\.trim\(\)\.toLowerCase\(\) : raw\), /g,
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? \(raw\.split\(";"\)\[0\] \?\? ""\)\.trim\(\) : raw\), /g,
];

/** How many times a set of shapes appears in one file. */
function countOf(source: string, patterns: readonly RegExp[]): number {
	return patterns.reduce((total, pattern) => total + (source.match(pattern) ?? []).length, 0);
}

describe("the generated validator says only what the document can say", () => {
	let files: string[] = [];

	beforeAll(async () => {
		// Compiled here, by this suite, into a directory only this suite writes. See `emitted-set.ts`.
		files = await compileEmittedSet("vocabulary");
	}, 600_000);

	it("has emitted output to inspect at all", () => {
		// Now a real floor rather than a hope: this suite compiled these files itself, moments ago.
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

	it("permits `z.preprocess` only as a wire decode of a known shape", () => {
		const permitted = [DELIMITER_SPLIT, ...SCALAR_DECODE, ...MEDIA_TYPE_DECODE];
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			const all = (source.match(/z\.preprocess\(/g) ?? []).length;
			expect(countOf(source, permitted), `an unrecognised z.preprocess in ${file}`).toBe(all);
		}
	});

	it("finds the delimiter splits it is meant to permit", () => {
		// Paired with the arm above, which passes trivially if the emitter stops emitting any.
		const splits = files.reduce(
			(total, file) => total + (readFileSync(file, "utf8").match(DELIMITER_SPLIT) ?? []).length,
			0,
		);
		expect(splits).toBeGreaterThanOrEqual(3);
	});

	it("finds the scalar decodes it is meant to permit", () => {
		/**
		 * ⚠️ **Its own floor, separate from the split's.** Folding both into one total would let the
		 * decodes fall to zero while the splits held the number up — and zero decodes is precisely the
		 * state this package shipped in, with 29 numeric query and header parameters across the corpus
		 * refusing every conformant request.
		 */
		const decodes = files.reduce(
			(total, file) => total + countOf(readFileSync(file, "utf8"), SCALAR_DECODE),
			0,
		);
		expect(decodes).toBeGreaterThanOrEqual(8);
	});

	it("finds the media type decodes it is meant to permit", () => {
		/**
		 * ⚠️ **Its own floor again, and it has to be.** 78 `content-type` validators across the corpus
		 * were emitted as bare literals; seventeen of them refused every syntactically valid multipart
		 * request, because the boundary parameter RFC 2046 requires is not in the literal. A shared
		 * total would let this fall back to zero while the other decodes held the number up.
		 */
		const decodes = files.reduce(
			(total, file) => total + countOf(readFileSync(file, "utf8"), MEDIA_TYPE_DECODE),
			0,
		);
		expect(decodes).toBeGreaterThanOrEqual(5);
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
