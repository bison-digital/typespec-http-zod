import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getHttpService } from "@typespec/http";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **What this package writes is ordered by what the spec declares, not by what another library's
 * decorator made the checker meet first** - see `declaration-order.ts`.
 *
 * Compiled twice: the service alone, and the service beside a file whose only statement is an
 * augment decorator naming one of its operations, as a GraphQL surface's `@link` does. The compiler
 * files interfaces as it finishes checking them, and checks the argument with the model it
 * decorates, so in the second compile `Gadgets` is met before `Status` and `Widgets`. Every file this
 * package writes must be the same bytes, in the declared order, though `@typespec/http` lists the
 * operations in the order the checker met them.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let alone: CompiledFixture;
let augmented: CompiledFixture;
beforeAll(async () => {
	alone = await compileFixture(here, "rest-only");
	augmented = await compileFixture(here, "augmented");
}, 300_000);

const written = (fixture: CompiledFixture): string[] =>
	readdirSync(fixture.outDir)
		.filter((name) => name.endsWith(".gen.ts"))
		.toSorted();

describe("an augment decorator naming an operation", () => {
	it("makes the checker meet the operation's interface first: the condition graded here", () => {
		const order = (fixture: CompiledFixture) => {
			const namespace = fixture.program.getGlobalNamespaceType().namespaces.get("Shop");
			if (namespace === undefined) throw new Error("no Shop");
			const [service] = getHttpService(fixture.program, namespace);
			return [...new Set(service.operations.map((operation) => operation.container.name))];
		};
		expect(order(alone)).toEqual(["Status", "Widgets", "Gadgets"]);
		expect(order(augmented)).toEqual(["Gadgets", "Status", "Widgets"]);
	});

	it("changes no byte of any file this package writes", () => {
		expect(written(alone)).toEqual(
			expect.arrayContaining(["schemas.gen.ts", "requests.gen.ts", "wire-contract.gen.ts"]),
		);
		expect(written(augmented)).toEqual(written(alone));
		for (const file of written(alone)) {
			expect(readFileSync(join(augmented.outDir, file), "utf8"), file).toBe(
				readFileSync(join(alone.outDir, file), "utf8"),
			);
		}
	});

	it("writes the routes and the declarations they reach in the order the spec declares them", () => {
		const schemas = readFileSync(join(augmented.outDir, "schemas.gen.ts"), "utf8");
		const declared = [...schemas.matchAll(/^export const (\w+) = /gm)].map((match) => match[1]);
		const routes = declared.filter((name) => name?.endsWith("Responses"));
		expect(routes).toEqual([
			"Status_readResponses",
			"Widgets_readResponses",
			"Widgets_createResponses",
			"Gadgets_readResponses",
		]);
		const models = ["widgetSchema", "gadgetSchema", "shelfSchema"];
		expect(declared.filter((name) => models.includes(name ?? ""))).toEqual(models);
	});
});
