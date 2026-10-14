import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { patternToRegex } from "../../src/constraints.js";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Spec text outside ASCII, in every position it can reach emitted code.**
 *
 * No generated file may carry a character outside printable ASCII, and every spec string this
 * emitter writes used to go through a bare `JSON.stringify`, which leaves such characters as they
 * are. The corpus kept that hidden by containing none, until descriptions carried
 * `"\u00a71.1 \u2014 Contains fields of primitive types."` into `schemas.gen.ts`. Each position in
 * the spec below is a distinct site that writes spec text as code.
 *
 * **The spec is written here, with escapes, and compiled from `.out/`**, because no tracked file
 * may carry such a character either (`test/portability.test.ts`), and a `.tsp` cannot spell an
 * identifier or a doc comment with an escape.
 */

const E_ACUTE = "\u00e9";
const SMILE = "\u{1f600}";
const CAFE = `caf${E_ACUTE}`;
const NAIVE = "na\u00efve";
const CREME = "cr\u00e8me";
const DOC = `\u00a71.1 \u2014 a ${CAFE} in ${NAIVE} prose, with an emoji: ${SMILE}.`;

const spec = `import "@typespec/http";

using Http;

@service(#{ title: "Non-ASCII" })
namespace NonAscii;

/** A label in the user's own language. */
enum Label {
  cafe: "${CAFE}",
  smile: "${SMILE}",
}

/** ${DOC} */
model Order {
  /** Named outside ASCII, so the key itself must be escaped. */
  \`${NAIVE}\`: string;

  label: Label;

  size: "petit" | "tr\u00e8s grand";

  @pattern("^${E_ACUTE}+${SMILE}?$")
  accent: string;

  note?: string = "d${E_ACUTE}faut";

  kind: Kind;
}

@discriminated(#{ envelope: "none", discriminatorPropertyName: "type" })
union Kind {
  \`${CREME}\`: Creme,
  plain: Plain,
}

model Creme {
  type: "${CREME}";
}

model Plain {
  type: "plain";
}

@route("/orders")
@post
op place(@body body: Order, @header("x-r${E_ACUTE}gion") region?: string): Order;
`;

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let schemas: Record<string, unknown>;

const order = {
	[NAIVE]: "x",
	label: CAFE,
	size: "tr\u00e8s grand",
	accent: `${E_ACUTE}${E_ACUTE}${SMILE}`,
	kind: { type: CREME },
};

beforeAll(async () => {
	const source = join(here, ".out", "source");
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, "nonascii.tsp"), spec);
	compiled = await compileFixture(source, "nonascii", { outName: "nonascii" });
	schemas = (await import(join(compiled.outDir, "schemas.gen.ts"))) as Record<string, unknown>;
}, 300_000);

const orderSchema = (): ZodType => schemas["orderSchema"] as ZodType;

describe("spec text outside ASCII", () => {
	it("compiles without a diagnostic", () => {
		expect(compiled.diagnostics).toEqual([]);
	});

	it("reaches no emitted file as anything but an escape", () => {
		const files = readdirSync(compiled.outDir).filter((name) => name.endsWith(".ts"));
		expect(files.length).toBeGreaterThanOrEqual(4);
		const offenders = files.flatMap((name) =>
			[...readFileSync(join(compiled.outDir, name), "utf8")]
				.filter((character) => !/^[\x20-\x7e\n\t]$/.test(character))
				.map((character) => `${name} U+${(character.codePointAt(0) ?? 0).toString(16)}`),
		);
		expect(offenders).toEqual([]);
	});

	it("keeps every value the spec wrote, at run time", () => {
		const parsed = orderSchema().parse(order) as Record<string, unknown>;
		expect(parsed).toEqual({ ...order, note: `d${E_ACUTE}faut` });
		expect((orderSchema() as { description?: string }).description).toBe(DOC);
		expect(orderSchema().safeParse({ ...order, label: SMILE }).success).toBe(true);
	});

	it("refuses what the spec's values do not include", () => {
		expect(orderSchema().safeParse({ ...order, label: "cafe" }).success).toBe(false);
		expect(orderSchema().safeParse({ ...order, size: "tres grand" }).success).toBe(false);
		expect(orderSchema().safeParse({ ...order, accent: "e" }).success).toBe(false);
		expect(orderSchema().safeParse({ ...order, kind: { type: "creme" } }).success).toBe(false);
		const unnamed: Record<string, unknown> = { ...order };
		delete unnamed[NAIVE];
		expect(orderSchema().safeParse(unnamed).success).toBe(false);
	});

	it("keys the header by its wire name", () => {
		const header = schemas["placeHeader"] as ZodType;
		expect(header.safeParse({ [`x-r${E_ACUTE}gion`]: "nord" }).success).toBe(true);
	});

	it("typechecks, the literal types included", () => {
		const { output, failed } = typecheckEmitted(compiled.outDir);
		expect(failed, output).toBe(false);
	});
});

/**
 * The regular-expression half, row by row against a `RegExp` built from the spec's own pattern,
 * because the emitted literal has to MATCH what the pattern matches, not merely look escaped.
 */
describe("a pattern outside ASCII", () => {
	const rows: readonly (readonly [string, readonly string[]])[] = [
		[`^${E_ACUTE}+${SMILE}?$`, [E_ACUTE, `${E_ACUTE}${E_ACUTE}${SMILE}`, "e", SMILE, ""]],
		["^[\u00e0-\u00fc]+$", [E_ACUTE, "\u00fc", "a", "\u00ff"]],
		["^.{2}$", [`${SMILE}${SMILE}`, "ab", SMILE]],
		[`^\\${E_ACUTE}$`, [E_ACUTE, `\\${E_ACUTE}`, "e"]],
	];

	for (const [pattern, values] of rows) {
		it(`matches what ${pattern} matches`, () => {
			const literal = patternToRegex(pattern);
			expect(literal).toMatch(/^[\x20-\x7e]+$/);
			const [, source = "", flags = ""] = /^\/(.*)\/([a-z]*)$/.exec(literal) ?? [];
			const emitted = new RegExp(source, flags);
			const declared = new RegExp(pattern, flags);
			for (const value of values) {
				expect(emitted.test(value), `${pattern} on ${value}`).toBe(declared.test(value));
			}
		});
	}
});
