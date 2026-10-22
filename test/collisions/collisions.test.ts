import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A name the emitter declares for itself is a name some spec has already given a model.**
 *
 * `requests.gen.ts` declares `Produced`, `Simplify`, `ByteStream` and its lookups beside the spec's
 * own types, and `schemas.gen.ts` declares `ResponseArm` beside them. A model named after any of
 * them was declared twice (`TS2300`), so the file did not compile - the same failure as a model named
 * after a reserved word, which this package already renames with a trailing `_`.
 *
 * **The names guarded are READ OFF THE OUTPUT, never taken from the list that guards them.** A
 * fixture built from the implementation's own list grades the list against itself and cannot see a
 * helper somebody adds later - which is exactly how the reserved-word guard once missed `as` and
 * `yield`. So `helpers.tsp` triggers every helper with every name of its own prefixed `Zq`, every
 * other top-level name the emitted files declare is taken to be the emitter's, and a second spec is
 * GENERATED declaring a model under each of those and compiled.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const OWN_PREFIX = /^zq/i;

/** The type-space names declared at the top of an emitted file, which is where a collision happens. */
function declaredTypeNames(source: string): string[] {
	return [...source.matchAll(/^(?:export )?(?:type|interface) ([A-Za-z_$][\w$]*)/gm)].map(
		(match) => match[1] ?? "",
	);
}

let helpers: readonly string[] = [];
let named: CompiledFixture;

beforeAll(async () => {
	const probe = await compileFixture(here, "helpers", { outName: "collisions-helpers" });
	helpers = [
		...new Set(
			["requests.gen.ts", "schemas.gen.ts"].flatMap((file) =>
				declaredTypeNames(readFileSync(join(probe.outDir, file), "utf8")),
			),
		),
	]
		.filter((name) => !OWN_PREFIX.test(name))
		.toSorted();

	const dir = join(here, ".out", "collisions-generated");
	mkdirSync(dir, { recursive: true });
	const models = helpers
		.map(
			(name) =>
				`model ${name} {\n  value: string;\n}\n\n@route("/${name}")\n@post\nop take${name}(@body body: ${name}): ${name};\n`,
		)
		.join("\n");
	writeFileSync(
		join(dir, "named.tsp"),
		/**
		 * Every helper triggered here too, by the same operations `helpers.tsp` declares: `ByteStream`
		 * is declared only beside a binary body, so a spec without one would never meet a model of
		 * that name. And `WireInputs` would not even fail: two interfaces of one name MERGE, so a model
		 * called that silently grew the lookup rather than breaking it.
		 */
		`import "@typespec/http";\n\nusing Http;\n\n// GENERATED from the helpers the emitted files declare. Do not edit.\n@service(#{ title: "named after helpers" })\nnamespace NamedAfterHelpers;\n\n@route("/upload")\n@post\nop zqUpload(@header contentType: "application/octet-stream", @body body: bytes): void;\n\n@route("/read")\n@get\nop zqRead(@header zqRec?: Record<int32>): void;\n\n${models}`,
	);
	named = await compileFixture(dir, "named", { outDir: join(here, ".out", "collisions-named") });
}, 300_000);

describe("a model may be named after anything the emitter declares", () => {
	it("found the helpers it is meant to guard", () => {
		// Named exactly, so one that stopped being emitted is noticed rather than counted past, and a
		// new one is a change somebody looks at.
		expect([...helpers].toSorted()).toEqual([
			"ByteStream",
			"Produced",
			"ResponseArm",
			"Simplify",
			"WireInputs",
			"WireOutputs",
			"WireReader",
			"WireReaders",
			"WireResults",
		]);
	});

	it("compiles a spec declaring a model under every one of them", () => {
		expect(named.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		// The helper interfaces are untouched by the models: a merge would add their `value` field.
		const requests = readFileSync(join(named.outDir, "requests.gen.ts"), "utf8");
		for (const lookup of ["WireInputs", "WireOutputs", "WireResults"]) {
			const body = new RegExp(`export interface ${lookup} \\{([\\s\\S]*?)\\n\\}`).exec(
				requests,
			)?.[1];
			expect(body, `${lookup} is missing`).toBeDefined();
			expect(body).not.toMatch(/^\tvalue:/m);
		}
		const { output, failed } = typecheckEmitted(named.outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
