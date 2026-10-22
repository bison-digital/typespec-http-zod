import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileEmittedSet } from "./support/emitted-set.js";

/**
 * **Every call in the generated Zod must be derivable from the document.**
 *
 * **The governing rule, asserted rather than trusted.** "Nothing in the runtime validator is
 * unsayable in the document" is the rule this package rests on, and a README can claim a rule that
 * nothing checks.
 *
 * That is the worst arrangement available: a rule everybody cites, nothing checks, and which
 * therefore drifts exactly as far as attention lapses. It matters more now, not less -
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
 * The one permitted `.refine`, written as the only form it may take.
 *
 * **A `HttpPart<File>` is a file, and this establishes it.** `@typespec/openapi3` publishes a bare
 * `{}` for such a part - in 3.1, and even where the part declares a content type. That is OpenAPI's
 * IDIOM for binary content in a multipart body rather than a statement that any value is
 * acceptable, and the transport agrees: Hono types a multipart part as `string | File` and nothing
 * else. So this refuses exactly one thing, a text field where the spec declared a file, and that
 * request is malformed against the spec the document was projected from.
 *
 * **Nothing becomes inexpressible, which is the test a carve-out has to pass.** A spec that means
 * "either" writes `HttpPart<File | string>` and gets a union; this only makes `HttpPart<File>` mean
 * what it says. Compare the `z.preprocess` carve-out below, admitted on the same footing: it cannot
 * turn a valid payload into an invalid one.
 *
 * Written out literally rather than imported from `src/`. An oracle that derives its expectation
 * from the code it grades cannot see that code change, which is the whole point of this file.
 */
const MULTIPART_FILE_REFINE =
	/z\.unknown\(\)\.refine\(\(value\): value is \{ name: string; type: string; arrayBuffer: \(\) => globalThis\.Promise<ArrayBuffer> \} => typeof value === "object" && value !== null && "name" in value && typeof value\.name === "string" && "type" in value && typeof value\.type === "string" && "arrayBuffer" in value && typeof value\.arrayBuffer === "function"\)/g;

/**
 * The permitted `z.preprocess` shapes - each written as the only form it may take.
 *
 * Every one of these undoes a TRANSPORT ENCODING before validation, so the document's own schema and
 * every constraint on it still run afterwards. A `preprocess` doing anything else - coercing,
 * defaulting, renaming - is still refused, because the document does not say it.
 *
 * **The line between "decoding" and "coercing" is whether an invalid value can become valid.**
 * `z.coerce.number()` is the forbidden thing and it is one character of effort: `Number("")` is `0`,
 * so `?limit=` would satisfy a required integer that the document forbids. Every decoder below passes
 * a malformed value through UNCHANGED, so it fails against the published schema and reports the error
 * the document justifies. That is the property that makes them derivable; it is not a matter of taste.
 */

/** A list flattened into one value by OpenAPI's `style`/`explode`, split back apart. */
const DELIMITER_SPLIT =
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? raw\.split\("(?:[^"\\]|\\.)*"\) : raw\), /g;

/**
 * An exploded list's single occurrence boxed into the one-element array the document describes -
 * `zValidator` hands one occurrence over as a bare string, several as an array. The mirror of
 * the split above: both re-establish the list shape the wire flattened, from the document's own
 * `style`/`explode` facts.
 */
const EXPLODED_BOX = /z\.preprocess\(\(raw\) => \(typeof raw === "string" \? \[raw\] : raw\), /g;

/**
 * A path, query, header or cookie value read from the only thing HTTP can carry: text.
 *
 * **`type: integer` on a query parameter describes the READ value, not the wire.** Without this
 * the emitted `z.number().int()` met `"1"` and refused it - measured against a Petstore server under
 * `wrangler dev`, `GET /pet/1` answered 400 to every conformant caller while `GET /user/alice` answered
 * 200. Same class as the split above: the transport carries text, the document describes the value.
 *
 * `wireRead` hands the schema the first of the number, the boolean and the text that it accepts, and
 * the first reading where it accepts none: a value the document refuses under every reading is
 * refused, and one it accepts under some reading is that reading. Nothing invalid becomes valid.
 */
const SCALAR_DECODE = [
	// The schema the text is read against is the schema that then validates it - the same text twice.
	/z\.preprocess\(\(raw\) => wireRead\(raw, ([^]+?)\), \1\)/g,
	/z\.preprocess\(\(raw\) => \(Array\.isArray\(raw\) \? raw\.map\(\(item\) => wireRead\(item, [^]+?\)\) : raw\), /g,
];

/**
 * The reader every decode above calls, pinned as it must read, since it is declared in the module
 * rather than written inline at each call: a number, then a boolean, then the text, the first the
 * schema accepts, else the first reading. Anything else under this name is a coercion.
 */
const WIRE_READ = `function wireRead(raw: unknown, schema: z.ZodType): unknown {
	if (typeof raw !== "string") return raw;
	const readings: unknown[] = [];
	if (/^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?$/.test(raw) && Number.isFinite(Number(raw))) {
		readings.push(Number(raw));
	}
	if (raw === "true" || raw === "false") readings.push(raw === "true");
	for (const reading of [...readings, raw]) if (schema.safeParse(reading).success) return reading;
	return readings[0] ?? raw;
}`;

/**
 * The schemas a record's or a model's values are read against: none, one, or one per key - and, for a
 * discriminated base, one such table per subtype.
 */
const READERS = String.raw`values: (?:null|[^]+?), fields: (?:null|\{ [^]+? \})(?:, by: \{ property: "(?:[^"\\]|\\.)*", readers: \{ [^]+? \} \})? \}\), `;

/**
 * A multipart part whose media type is JSON, decoded from the JSON text a form carries.
 *
 * **The document describes the decoded value; the transport carries text.** `@typespec/http` resolves
 * `application/json` for a model or array part, a client writes it as JSON text with that content
 * type and no filename, and `c.req.parseBody()` hands over a string. Measured on the bytes the Postman
 * CLI sends: `expected object, received string`, and a 400 from a generated server. Text that is not
 * JSON becomes an issue rather than a string, so the decode never widens what a part admits.
 */
const JSON_PART_DECODE =
	/z\.preprocess\(\(raw, ctx\) => \{ if \(typeof raw !== "string"\) return raw; try \{ return JSON\.parse\(raw\); \} catch \{ ctx\.addIssue\(\{ code: "custom", message: "Invalid JSON in a multipart part" \}\); return z\.NEVER; \} \}, /g;

/** A JSON string literal, as `JSON.stringify` writes one into emitted source. */
const JSON_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
/** A JSON array of such strings. */
const JSON_STRINGS = String.raw`\[(?:${JSON_STRING}(?:,${JSON_STRING})*)?\]`;

/**
 * An RFC 6570 expansion undone back into the value it expanded, from the route's own template.
 *
 * **The document describes the value; the router hands over the segment text.** `array{.param*}`
 * arrives as `array.a.b` for `["a", "b"]`, and a path list was never split nor a record paired, so
 * typespec-hono answered 404 or 400 to the requests `@typespec/http-specs` `routes` declares. The
 * decoder refuses text that is not the declared expansion, so it never widens what a parameter admits.
 */
const URI_EXPANSION_DECODE = new RegExp(
	String.raw`z\.preprocess\(\(raw, ctx\) => uriExpansion\(raw, ctx, \{ prefix: ${JSON_STRING}, suffix: ${JSON_STRING}, operator: "(?:|\+|#|\.|/|;)", name: ${JSON_STRING}, explode: (?:true|false), shape: "(?:scalar|list|record|any)", ${READERS}`,
	"g",
);

/**
 * A form-exploded record or model gathered back under its parameter name: `?a=1&b=2` has no
 * `param` key until this puts one there, and the query object's schema then validates the result.
 */
const EXPLODED_QUERY_GATHER = new RegExp(
	String.raw`z\.preprocess\(\(raw\) => explodedQuery\(raw, \{ name: ${JSON_STRING}, others: ${JSON_STRINGS}, keys: (?:null|${JSON_STRINGS}), itself: (?:true|false), ${READERS}`,
	"g",
);

/**
 * A `content-type` header reduced to the media type, discarding the parameters the document does not
 * mention.
 *
 * **Refusing parameters is enforcing something the document cannot state**, and it made every
 * multipart request fail - the boundary parameter RFC 2046 requires is exactly what the literal
 * refused. Both spellings are permitted: the lowercasing one applies when the declared literal is
 * itself lowercase, which is every literal openapi3 publishes across this corpus.
 */
const MEDIA_TYPE_DECODE = [
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? \(raw\.split\(";"\)\[0\] \?\? ""\)\.trim\(\)\.toLowerCase\(\) : raw\), /g,
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? \(raw\.split\(";"\)\[0\] \?\? ""\)\.trim\(\) : raw\), /g,
];

/**
 * A repeated multipart part sent once, boxed into the one-element list the document describes, for
 * the route's request only, and only what a form delivers for one part: text or a file. One whose
 * text may be JSON is boxed only where its text is not the JSON list the part accepts.
 */
const BOX_ONE = String.raw`if \(typeof value === "string" \|\| \(value !== null && typeof value === "object" && !Array\.isArray\(value\) && "arrayBuffer" in value\)\) boxed\[key\] = \[value\];`;
const MULTIPART_REPEATED_BOX = new RegExp(
	String.raw`z\.preprocess\(\(raw\) => \{ if \(raw === null \|\| typeof raw !== "object" \|\| Array\.isArray\(raw\)\) return raw; const boxed: globalThis\.Record<string, unknown> = \{ \.\.\.raw \};(?: for \(const key of ${JSON_STRINGS}\) \{ const value = boxed\[key\]; ${BOX_ONE} \})?(?: for \(const \[key, list\] of \[[^]+?\] as const\) \{ const value = boxed\[key\]; if \(typeof value === "string"\) \{ try \{ if \(list\.safeParse\(JSON\.parse\(value\)\)\.success\) continue; \} catch \{ \/\* text, one element \*\/ \} \} ${BOX_ONE} \})? return boxed; \}, `,
	"g",
);

/**
 * A multipart JSON part the document publishes as a list, decoded from one text as the whole list or
 * from several, one per part, as its elements. Text that is not JSON is an issue, as for any JSON part.
 */
const JSON_LIST_PART_DECODE =
	/z\.preprocess\(\(raw, ctx\) => \{ try \{ if \(typeof raw === "string"\) return JSON\.parse\(raw\); if \(Array\.isArray\(raw\)\) return raw\.map\(\(each: unknown\) => \(typeof each === "string" \? JSON\.parse\(each\) : each\)\); \} catch \{ ctx\.addIssue\(\{ code: "custom", message: "Invalid JSON in a multipart part" \}\); return z\.NEVER; \} return raw; \}, /g;

/**
 * A multipart text part of a union holding a list, read as one value or as the parts sent, as a
 * URL-encoded form's field is: `int32 | int32[]` sent as `1` and `2` is `[1, 2]`.
 */
const TEXT_PART_READ =
	/z\.preprocess\(\(raw\) => wireReadAs\(raw, \{ each: [^]+?, whole: [^]+? \}\), /g;

/**
 * A multipart part that is text or JSON - `HttpPart<int32 | Address>`, published `text/plain,
 * application/json` - read as the JSON its text spells where the schema accepts that, else as text.
 */
const JSON_OR_TEXT_PART =
	/z\.preprocess\(\(raw\) => \{ if \(typeof raw !== "string"\) return raw; try \{ const parsed: unknown = JSON\.parse\(raw\); if \([^]+?\.safeParse\(parsed\)\.success\) return parsed; \} catch \{ \/\* text, read as text \*\/ \} return raw; \}, /g;

/** A form-exploded query gathered once for a union of models, read as one member reads it. */
const WIRE_READ_OBJECT = new RegExp(
	String.raw`z\.preprocess\(\(raw\) => wireReadObject\(raw, \{ ${READERS}`,
	"g",
);

/**
 * A form-exploded parameter that may be an object or a list, read as the list or the scalar it was
 * sent as itself, out of the query its objects' gatherer took: `?x=1&x=2` for `int32[] | Record<int32>`.
 */
const WIRE_ITSELF = /z\.preprocess\(\(raw, ctx\) => wireItself\(raw, ctx\), /g;

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
		/**
		 * **Every floor in this file is calibrated against the whole sweep.** A floor calibrated
		 * against a narrowed one - a handful of local fixtures, 46 files rather than the corpus's 277 -
		 * sits an order of magnitude under what is measured and passes through almost any regression.
		 *
		 * They are set at roughly half the measured value, which is this package's convention: loose
		 * enough to survive a corpus bump that removes scenarios, tight enough to fail a real reduction
		 * in coverage.
		 */
		// Now a real floor rather than a hope: this suite compiled these files itself, moments ago.
		expect(files.length).toBeGreaterThanOrEqual(100);
	});

	it("uses no Zod call that enforces something the document cannot state", () => {
		/**
		 * Empty, not a count. An allowance that survives the thing it allowed has stopped guarding
		 * anything.
		 */
		const offenders = files.flatMap((file) => {
			// The permitted shape is removed first, so anything left is by definition not it.
			const source = readFileSync(file, "utf8").replaceAll(MULTIPART_FILE_REFINE, "");
			return [...source.matchAll(NOT_DERIVABLE)].map((match) => `${match[1]} in ${file}`);
		});
		expect(offenders).toEqual([]);
	});

	it("finds the multipart file refinements it is meant to permit", () => {
		/**
		 * **Paired with the arm above, which passes trivially if the emitter stops emitting any.** A
		 * carve-out that survives the thing it was written for has stopped guarding anything, and the
		 * exemption above would then be silently admitting a shape nobody produces - or worse, still
		 * stripping text that had come to mean something else.
		 */
		const refinements = files.reduce(
			(total, file) =>
				total + (readFileSync(file, "utf8").match(MULTIPART_FILE_REFINE) ?? []).length,
			0,
		);
		// Nine across the corpus when written; set at roughly half, this file's convention.
		expect(refinements).toBeGreaterThanOrEqual(4);
	});

	it("permits `z.preprocess` only as a wire decode of a known shape", () => {
		const permitted = [
			DELIMITER_SPLIT,
			EXPLODED_BOX,
			...SCALAR_DECODE,
			...MEDIA_TYPE_DECODE,
			JSON_PART_DECODE,
			URI_EXPANSION_DECODE,
			EXPLODED_QUERY_GATHER,
			MULTIPART_REPEATED_BOX,
			JSON_LIST_PART_DECODE,
			TEXT_PART_READ,
			JSON_OR_TEXT_PART,
			WIRE_READ_OBJECT,
			WIRE_ITSELF,
		];
		let jsonParts = 0;
		let jsonLists = 0;
		let textReads = 0;
		let jsonBoxes = 0;
		let expansions = 0;
		let gathers = 0;
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			const all = (source.match(/z\.preprocess\(/g) ?? []).length;
			expect(countOf(source, permitted), `an unrecognised z.preprocess in ${file}`).toBe(all);
			jsonParts += countOf(source, [JSON_PART_DECODE]);
			jsonLists += countOf(source, [JSON_LIST_PART_DECODE]);
			textReads += countOf(source, [TEXT_PART_READ]);
			jsonBoxes += (source.match(MULTIPART_REPEATED_BOX) ?? []).filter((box) =>
				box.includes("as const"),
			).length;
			expansions += countOf(source, [URI_EXPANSION_DECODE]);
			gathers += countOf(source, [EXPLODED_QUERY_GATHER]);
		}
		// 24 and 3 across the corpus when written, all in `routes`; set at half.
		expect(expansions).toBeGreaterThanOrEqual(12);
		expect(gathers).toBeGreaterThanOrEqual(1);
		// Four across the corpus when written; set at half, this file's convention, so the allowance
		// cannot outlive the shape it was written for.
		expect(jsonParts).toBeGreaterThanOrEqual(2);
		// 10, 5 and 3 when written, from the corpus and `declarationviews/forms`; set at half.
		expect(jsonLists).toBeGreaterThanOrEqual(5);
		expect(textReads).toBeGreaterThanOrEqual(2);
		expect(jsonBoxes).toBeGreaterThanOrEqual(1);
	});

	it("finds the delimiter splits it is meant to permit", () => {
		// Paired with the arm above, which passes trivially if the emitter stops emitting any.
		const splits = files.reduce(
			(total, file) => total + (readFileSync(file, "utf8").match(DELIMITER_SPLIT) ?? []).length,
			0,
		);
		expect(splits).toBeGreaterThanOrEqual(8);
	});

	it("declares the one reader every decode calls, reading as it must", () => {
		let declared = 0;
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			if (!source.includes("function wireRead(")) continue;
			declared += 1;
			expect(source, file).toContain(WIRE_READ);
		}
		// 10 across the sweep when written; set at half, this file's convention.
		expect(declared).toBeGreaterThanOrEqual(5);
	});

	it("finds the scalar decodes it is meant to permit", () => {
		/**
		 * **Its own floor, separate from the split's.** Folding both into one total would let the
		 * decodes fall to zero while the splits held the number up - and zero decodes is precisely the
		 * state this package shipped in, with 29 numeric query and header parameters across the corpus
		 * refusing every conformant request.
		 */
		const decodes = files.reduce(
			(total, file) => total + countOf(readFileSync(file, "utf8"), SCALAR_DECODE),
			0,
		);
		expect(decodes).toBeGreaterThanOrEqual(20);
	});

	it("finds the exploded boxes it is meant to permit", () => {
		// Same rule as the two floors above: a permitted shape the emitter stops emitting is the
		// defect coming back, and a total of zero has to fail here rather than pass quietly. The
		// corpus carries exploded array parameters in the collection-format and routes scenarios.
		const boxes = files.reduce(
			(total, file) => total + countOf(readFileSync(file, "utf8"), [EXPLODED_BOX]),
			0,
		);
		expect(boxes).toBeGreaterThanOrEqual(3);
	});

	it("finds the media type decodes it is meant to permit", () => {
		/**
		 * **Its own floor again, and it has to be.** 78 `content-type` validators across the corpus
		 * were emitted as bare literals; seventeen of them refused every syntactically valid multipart
		 * request, because the boundary parameter RFC 2046 requires is not in the literal. A shared
		 * total would let this fall back to zero while the other decodes held the number up.
		 */
		const decodes = files.reduce(
			(total, file) => total + countOf(readFileSync(file, "utf8"), MEDIA_TYPE_DECODE),
			0,
		);
		expect(decodes).toBeGreaterThanOrEqual(40);
	});

	it("enforces a declared TYPE and never an @format ANNOTATION, which is the DECISION", () => {
		/**
		 * **A type is a claim about the value; an annotation is a hint about it.**
		 *
		 * `utcDateTime`, `url`, `plainDate`, `plainTime` and `duration` are scalars a spec DECLARES, and
		 * the emitter checks them. Emitting `z.string()` for them discarded a declared type: a service
		 * promising a timestamp accepted `banana`, and getting the check meant rewriting the spec as
		 * `string` with a `@pattern` - losing `format: date-time` from the document AND getting a weaker
		 * check, since a hand-written pattern accepts `2026-02-31`. A rule that pushes authors into
		 * writing worse specs is the wrong rule.
		 *
		 * **`@format("...")` on a plain string is NOT enforced**, and that half of the decision is
		 * unchanged. Under JSON Schema 2020-12, which OpenAPI 3.1 uses, `format` is an annotation rather
		 * than an assertion, so enforcing an author's hint would add a rule the contract does not state.
		 * `@format("product-code")` is the case proving no general rule exists.
		 *
		 * This arm previously asserted that NO format-derived check was ever emitted, and its docblock
		 * said turning that on should break a test rather than move a counter. It did. This is the
		 * deliberate change, and the arm now holds the new line rather than being deleted: the checks
		 * that appear must be exactly the ones a declared type justifies.
		 */
		const TYPE_DERIVED = /z\.iso\.(datetime|date|time|duration)\(|z\.url\(\)/g;
		const ANNOTATION_DERIVED =
			/\.(email|uuid|uuidv4|uuidv7|cuid|cuid2|ulid|emoji|base64|base64url|nanoid|jwt|ipv4|ipv6|cidrv4|cidrv6|e164|httpUrl|creditCard)\(/g;

		let typeDerived = 0;
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			typeDerived += [...source.matchAll(TYPE_DERIVED)].length;
			offenders.push(
				...[...source.matchAll(ANNOTATION_DERIVED)].map((match) => `${match[0]} in ${file}`),
			);
		}
		// No check may come from an annotation, in any file the sweep reads.
		expect(offenders).toEqual([]);
		/**
		 * And a floor, because "no annotation-derived checks" is also true of an emitter that stopped
		 * checking anything at all - which is precisely the state this arm used to assert.
		 */
		expect(typeDerived, "no type-derived check was emitted anywhere").toBeGreaterThanOrEqual(10);
	});

	it("ships no decorator of its own for a spec to depend on", () => {
		/**
		 * **The other half, and without it the arm above can be satisfied by a spec that simply
		 * stopped using the decorator.** A decorator of the emitter's own - `@trimmed`, `@loose`,
		 * `@externalValues`, `@refine` - lets a spec state something `@typespec/openapi3` cannot publish,
		 * so the emitted validator would enforce a rule no caller reading the contract can see.
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
