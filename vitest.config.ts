import { defineConfig } from "vitest/config";

// The emitter is a build-time tool, not Workers code - plain Node. The suite compiles TypeSpec and
// shells out to `tsc`, so it needs headroom well past the 5s default.
//
// **No `globalSetup`.** Each suite compiles what it needs through `test/support/compile-fixture.ts`,
// so no fixture is shared across suites. A `globalSetup` naming a file that does not exist fails the
// whole run before a single test is collected.
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		testTimeout: 180_000,
		/**
		 * **The same headroom for hooks, which is where the compiling happens.** Only `testTimeout`
		 * was set, so a `beforeAll` compiling several fixtures kept vitest's 10s default: measured,
		 * `emit.test.ts`'s five compiles take 4.4s alone and timed out inside the full run once the
		 * corpus grew, from contention rather than from anything the emitter does.
		 */
		hookTimeout: 180_000,
	},
});
