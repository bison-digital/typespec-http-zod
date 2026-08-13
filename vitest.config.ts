import { defineConfig } from "vitest/config";

// The emitter is a build-time tool, not Workers code - plain Node. The suite compiles TypeSpec and
// shells out to `tsc`, so it needs headroom well past the 5s default.
//
// **No `globalSetup`.** The un-split package compiled a shared "spike" fixture once before any
// suite ran; that spike was 444 lines of one application's domain and does not travel. Each suite
// compiles what it needs through `test/support/compile-fixture.ts`. A `globalSetup` naming a file
// that does not exist fails the whole run before a single test is collected, which is how this line
// arrived here - copied, not chosen.
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		testTimeout: 180_000,
	},
});
