import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Every vendored file matches the digest recorded beside it.**
 *
 * Two kinds of vendoring here, for two different reasons, and both fail the same way without this:
 *
 * - **`service.tsp`** is shared with `typespec-hono`, which holds a copy. Two copies in two
 *   repositories with nothing comparing them is drift waiting to happen, and the failure is silent:
 *   each suite passes against its own copy while the two specs describe different services.
 * - **`documents/*`** are published OpenAPI documents the round-trip suite converts and re-emits. A
 *   suite that fetches them decides its own result on a value it did not supply.
 *
 * ⚠️ **The version of this inherited from the un-split package did not exist.** Its
 * `documents/PROVENANCE.md` recorded two digests and asserted neither — and one of them had never
 * matched the file it described, from the commit that introduced it. The record said, in as many
 * words, that "the digest is what makes this checkable rather than asserted"; nothing checked it.
 *
 * ⚠️ **Asserted as a CLASS over every file in the directory**, not as the two names somebody thought
 * of. A third document added without a digest fails here rather than joining silently.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

function digestOf(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Every `sha256` the record names, whatever table or prose it sits in. */
function recordedDigests(provenance: string): Set<string> {
	return new Set([...provenance.matchAll(/\b([0-9a-f]{64})\b/g)].map((match) => match[1] ?? ""));
}

describe("the shared reference service matches its recorded digest", () => {
	const provenance = readFileSync(join(here, "reference", "PROVENANCE.md"), "utf8");

	it("has a provenance record naming a digest", () => {
		expect(provenance).toMatch(/sha256\s+[0-9a-f]{64}/);
	});

	it("matches it byte for byte", () => {
		const recorded = /sha256\s+([0-9a-f]{64})/.exec(provenance)?.[1];
		expect(
			digestOf(join(here, "reference", "service.tsp")),
			"service.tsp changed: update PROVENANCE.md here AND the copy in typespec-hono",
		).toBe(recorded);
	});
});

describe("every vendored reference document matches its recorded digest", () => {
	const documentsDir = join(here, "reference", "documents");
	const provenance = readFileSync(join(documentsDir, "PROVENANCE.md"), "utf8");
	const documents = readdirSync(documentsDir).filter(
		(file) => file.endsWith(".json") || file.endsWith(".yaml"),
	);

	it("has documents to check at all", () => {
		// Without this the arms below pass the day the directory empties or the filter stops matching.
		expect(documents.length).toBeGreaterThanOrEqual(2);
	});

	it("records a digest for every document, and a document for every digest", () => {
		/**
		 * Both directions. A document with no digest joins the corpus unverified; a digest with no
		 * document is a record of something no longer here, which reads as coverage.
		 */
		expect(recordedDigests(provenance).size).toBe(documents.length);
	});

	it("matches every one of them byte for byte", () => {
		const recorded = recordedDigests(provenance);
		const drifted = documents.filter((file) => !recorded.has(digestOf(join(documentsDir, file))));
		expect(
			drifted.toSorted(),
			"a vendored document changed: re-download, read the diff, and update PROVENANCE.md",
		).toEqual([]);
	});

	it("is never fetched at run time", () => {
		/**
		 * ⚠️ **Hermetic is a property of the code, not an intention.** The round-trip pipeline reads
		 * these from disk; a `fetch` anywhere in it would make the suite's result depend on a server
		 * nobody here controls, and the failure would look like an emitter defect.
		 */
		const pipeline = readFileSync(join(here, "reference", "roundtrip.ts"), "utf8");
		expect(pipeline).not.toMatch(/\bfetch\(|node-fetch|undici|axios/);
	});
});
