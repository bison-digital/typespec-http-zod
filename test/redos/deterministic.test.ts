import { describe, expect, it } from "vitest";
import { patternIsProvablySafe } from "../../src/constraints.js";

/**
 * **A pattern's verdict does not depend on how busy the machine is.**
 *
 * The analysis was bounded by 500 ms of wall-clock time, and running out of time read as "not proven
 * safe". A safe alternation of long fixed-length runs takes a few hundred milliseconds to decide idle,
 * so on a loaded host it could run out: the same spec warned on one run and not the next, and with
 * `warn-as-error` the build was flaky. The bound is now `redos-detector`'s step count, which is the
 * same on every machine.
 *
 * The control is a clock that jumps a second on every reading, which is a machine so loaded that any
 * wall-clock budget is spent before the first step. Patterns unique to this file, so the per-process
 * verdict cache cannot answer for them.
 */
describe("the ReDoS verdict is the same on a loaded machine", () => {
	it("decides by steps, whatever the clock says", () => {
		const real = Date.now;
		let clock = real();
		Date.now = () => (clock += 1000);
		try {
			expect(patternIsProvablySafe("^([A-Z]{20}|[A-Z]{40}|[A-Z]{80})$")).toBe(true);
			expect(patternIsProvablySafe("^(\\w+\\s?)*\\-\\-$")).toBe(false);
		} finally {
			Date.now = real;
		}
	});
});
