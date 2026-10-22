import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Run `tsc` over one emitted directory, under the settings a consumer builds with.
 *
 * **Shared, because this is the only harness in the package that compiles emitted output.** Every
 * other arm reads the text. Text cannot answer the question a consumer actually asks - "can I hand
 * my own value to this type" - and a defect that only a compiler can see shipped in `0.16.0`
 * precisely because nothing but `emit.test.ts` ever ran one.
 */
export function typecheckEmitted(outDir: string): { output: string; failed: boolean } {
	/**
	 * A tsconfig written beside the output, so the compiler sees exactly the generated files and
	 * nothing of this package's own source. `strict` and `exactOptionalPropertyTypes` because an
	 * emitter whose output only compiles under lenient settings has pushed its problem downstream.
	 *
	 * `types: []` and `lib: ["es2023"]` together are load-bearing rather than tidy: they are what
	 * prove the emitted output depends on no ambient library. A type only reachable through `lib.dom`
	 * or `@types/node` - `File` is the one this package nearly emitted - compiles here only if it is
	 * spelled structurally.
	 *
	 * **`types: []` alone proved half of that.** With no `lib`, TypeScript injects its default
	 * libraries, which include the DOM, so `File`, `ReadableStream` and `Response` all resolved here.
	 * Measured: spelling the multipart file part as `File` left every arm green, while a project
	 * compiling its contracts under `lib: ["ES2024"]` and no `types` gets TS2304.
	 */
	const config = join(outDir, "tsconfig.emitted.json");
	writeFileSync(
		config,
		JSON.stringify(
			{
				compilerOptions: {
					target: "es2023",
					lib: ["es2023"],
					module: "nodenext",
					moduleResolution: "nodenext",
					strict: true,
					exactOptionalPropertyTypes: true,
					noUncheckedIndexedAccess: true,
					/**
					 * **Unused code is an ERROR here, and that is the point rather than tidiness.**
					 *
					 * A generated file has to pass the lint of whatever project it lands in, and a declaration
					 * written for a construct the service does not use fails it on day one. Three have shipped:
					 * `zValidator` and `z` imported unconditionally, and `Simplify<T>` written into the contract
					 * types of a service with nothing to flatten. **Without this flag**, the arm that compiles
					 * emitted output stays green on output a project's first strict build refuses.
					 */
					noUnusedLocals: true,
					noUnusedParameters: true,
					noEmit: true,
					skipLibCheck: true,
					types: [],
				},
				include: ["./*.ts"],
			},
			null,
			"\t",
		),
	);

	let output = "";
	let failed = false;
	try {
		output = execFileSync(
			fileURLToPath(new URL("../../node_modules/.bin/tsc", import.meta.url)),
			["-p", config, "--ignoreConfig"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
	} catch (error) {
		failed = true;
		const asExec = error as { stdout?: string; stderr?: string };
		output = `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`;
	}
	return { output, failed };
}
