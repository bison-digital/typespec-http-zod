/**
 * Compiles `reportonce.tsp` with this emitter and with a second emitter built on it, and prints each
 * diagnostic's count by source location. Run in a plain Node process: the compiler and both emitters
 * then share one copy of this library, as they do in a consumer's `tsp compile`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";

const here = dirname(fileURLToPath(import.meta.url));
const emitters = ["typespec-http-zod", join(here, "second-emitter")];
const out = join(here, ".out", "two-emitters");
const program = await compile(NodeHost, join(here, "reportonce.tsp"), {
	outputDir: out,
	emit: emitters,
	options: Object.fromEntries(
		emitters.map((emitter, index) => [
			emitter,
			{ "emitter-output-dir": join(out, String(index)), "seal-object-schemas": true },
		]),
	),
});
const counts = {};
for (const d of program.diagnostics) {
	const key = `${d.code} ${d.target?.node?.pos ?? "?"}`;
	counts[key] = (counts[key] ?? 0) + 1;
}
console.log(JSON.stringify(counts));
