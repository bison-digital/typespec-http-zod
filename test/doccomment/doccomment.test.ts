import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "@typespec/compiler/ast";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A doc comment the compiler truncated, reported rather than passed on silently.** See
 * `doccomment.tsp`, and the `truncated-doc-comment` docblock in `lib.ts` for the rule.
 *
 * The consumer who reported this suggested warning when a doc string about to be emitted contains
 * `{@`. That cannot work: by the time `getDoc` returns, the `@` is gone. Their own guard, which
 * fails when a description ends at a brace, passes the `@maxLength` row below cleanly. So the arms
 * here grade the node, and the last one pins the parse the rule is derived from.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "doccomment", { outName: "doccomment" });
}, 300_000);

function warnings(): readonly string[] {
	return compiled.diagnostics
		.filter((diagnostic) => diagnostic.code.endsWith("truncated-doc-comment"))
		.map((diagnostic) => diagnostic.code);
}

describe("a doc comment the compiler cut short", () => {
	it("compiles without an error, because the spec is representable", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("reports one warning per truncated comment, and only for those", () => {
		// Linked, Addressed, Property.id. Escaped, Backticked, Braced, Tagged and Decorated must not.
		expect(warnings().length).toBe(3);
	});

	it("is a warning rather than an error", () => {
		const reported = compiled.diagnostics.filter((d) => d.code.endsWith("truncated-doc-comment"));
		expect(reported.map((d) => d.severity)).toEqual(["warning", "warning", "warning"]);
	});
});

/**
 * **The rule is derived from how the compiler parses, so the parse is pinned.**
 *
 * `@typespec/compiler/ast` states that libraries depend on the syntax tree at their own risk and
 * outside the breaking-change policy. This arm is what makes that risk visible: a compiler upgrade
 * that changes any row turns it red, instead of leaving the guard quietly switched off.
 *
 * Every row was measured against `1.15.0` before the rule was written.
 */
describe("the compiler parse this rule is derived from", () => {
	const rows: readonly {
		readonly label: string;
		readonly source: string;
		readonly tag: string | undefined;
		readonly text: string;
	}[] = [
		{
			label: "brace in prose",
			source: "/** A: prose with { this } here. */\nmodel A { id: string; }",
			tag: undefined,
			text: "A: prose with { this } here.",
		},
		{
			label: "backticked brace",
			source: "/** B: a backticked `{ brace }` here. */\nmodel B { id: string; }",
			tag: undefined,
			text: "B: a backticked `{ brace }` here.",
		},
		{
			label: "link tag",
			source: "/** D: link {@link A} then more. */\nmodel D { id: string; }",
			tag: "link",
			text: "D: link {",
		},
		{
			label: "bare email",
			source: "/** E: contact support@example.com now. */\nmodel E { id: string; }",
			tag: "example",
			text: "E: contact support",
		},
		{
			label: "decorator in prose",
			source: "/** F: use @maxLength to bound it. */\nmodel F { id: string; }",
			tag: "maxLength",
			text: "F: use",
		},
		{
			label: "escaped at-sign",
			source: "/** G: contact support\\@example.com now. */\nmodel G { id: string; }",
			tag: undefined,
			text: "G: contact support@example.com now.",
		},
		{
			label: "backticked at-sign",
			source: "/** H: contact `support@example.com` now. */\nmodel H { id: string; }",
			tag: undefined,
			text: "H: contact `support@example.com` now.",
		},
		{
			label: "known tag",
			source: "/** I: documented.\n * @param id the id\n */\nmodel I { id: string; }",
			tag: "param",
			text: "I: documented.",
		},
	];

	for (const row of rows) {
		it(`${row.label}: description is ${JSON.stringify(row.text)}`, () => {
			const script = parse(row.source, { docs: true });
			const statement = script.statements[0] as {
				docs?: readonly {
					content: readonly { text: string }[];
					tags: readonly { tagName: { sv: string } }[];
				}[];
			};
			const doc = statement.docs?.[0];
			expect(doc?.content.map((part) => part.text).join("")).toBe(row.text);
			expect(doc?.tags.map((tag) => tag.tagName.sv)).toEqual(
				row.tag === undefined ? [] : [row.tag],
			);
			// Silent in every case: nothing in the compiler says the text was dropped.
			expect(script.parseDiagnostics).toEqual([]);
		});
	}
});

/**
 * **The document publishes the SAME truncated text, which is why this warning is not a divergence.**
 *
 * `test/conformance/differential.test.ts` asserts that this emitter raises zero warnings across the
 * corpus, on the stated ground that a warning means it is knowingly shipping output the document
 * does not describe. `truncated-doc-comment` says the opposite, and this arm is the proof rather
 * than the assurance: `@typespec/openapi3` derives every description from `getDoc`
 * (`schema-emitter.js` applies it as `description`, and `openapi.js` calls it for operations,
 * parameters, parts and bodies), so it cannot publish text `getDoc` has already dropped.
 *
 * Measured on the corpus as well as here: `payload/xml` in `@typespec/http-specs` documents a model
 * with `has @Xml.name. The property name takes precedence.` and the published 3.1 document carries
 * `'S2.2 - Contains a property whose type has'`. The rule the model exists to state is not in the
 * contract. That is a live instance in the TypeSpec team's own conformance suite.
 */
describe("the document truncates identically", () => {
	it("publishes the cut description, so emitter and document agree", async () => {
		const { compile, NodeHost } = await import("@typespec/compiler");
		const { join } = await import("node:path");
		const { readFileSync, readdirSync } = await import("node:fs");
		const outDir = join(here, ".out", "doccomment-document");
		const program = await compile(NodeHost, join(here, "doccomment.tsp"), {
			emit: ["@typespec/openapi3"],
			options: { "@typespec/openapi3": { "emitter-output-dir": outDir, "file-type": "json" } },
		});
		expect(program.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		const file = readdirSync(outDir).find((name) => name.endsWith(".json"));
		expect(file, "no document written").toBeDefined();
		const document = JSON.parse(readFileSync(join(outDir, file ?? ""), "utf8")) as {
			components: { schemas: Record<string, { description?: string }> };
		};
		const schemas = document.components.schemas;
		// Cut at the tag, in the published contract, exactly as this emitter reported.
		expect(schemas["Linked"]?.description).toBe("A model whose description stops at a link tag {");
		expect(schemas["Addressed"]?.description).toBe(
			"A model whose description reaches an address at support",
		);
		// And the spellings that survive, survive in the document too, so the arm is not vacuous.
		expect(schemas["Braced"]?.description).toBe(
			"A model with a brace in prose like { this }, which is not affected at all.",
		);
		expect(schemas["Decorated"]?.description).toBe(
			"A description set by the decorator, where {@link Other} is just characters.",
		);
	}, 300_000);
});
