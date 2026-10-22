import { describe, expect, it } from "vitest";
import { isTextualMediaType, type ResponseFacts, resultMembersOf } from "../../src/index.js";

/**
 * **Whether a body nothing parses is text or bytes is decided by its media type's registration.**
 * Text is the `text` top-level type (RFC 2046) and the XML types (RFC 7303); anything else is bytes,
 * because decoded as UTF-8 every byte that is not a valid sequence becomes U+FFFD.
 */
describe("a textual media type", () => {
	it.each([
		"text/plain",
		"text/csv; charset=utf-8",
		"Text/HTML",
		"application/xml",
		"Application/XML",
		"application/atom+xml",
		"image/svg+xml",
	])("is text: %s", (type) => {
		expect(isTextualMediaType(type)).toBe(true);
	});

	it.each([
		"application/octet-stream",
		"application/x-protobuf",
		"application/pdf",
		"image/png",
		"application/xml-dtd-not-a-suffix",
	])("is not text: %s", (type) => {
		expect(isTextualMediaType(type)).toBe(false);
	});
});

const facts = (
	contentTypes: readonly string[],
	kind: Partial<ResponseFacts> = {},
): ResponseFacts => ({
	status: 200,
	contentTypes,
	binary: false,
	streamed: false,
	textual: false,
	...kind,
});

const servedAs = (response: ResponseFacts) =>
	resultMembersOf([response], () => true).map((member) => [
		member.mediaType,
		member.serving,
		member.unvalidated,
	]);

describe("how a result member's body is served, and whether its schema is checked", () => {
	it("answers a model under a media type that is not text as bytes, unchecked", () => {
		expect(servedAs(facts(["application/octet-stream"]))).toEqual([
			["application/octet-stream", "binary", true],
		]);
	});

	it("answers a model under XML as text, unchecked", () => {
		expect(servedAs(facts(["application/xml", "application/json"]))).toEqual([
			["application/xml", "unvalidated", true],
			["application/json", "json", false],
		]);
	});

	it("marks neither bytes, which declare no schema, nor a string, which is checked as text", () => {
		expect(servedAs(facts(["application/octet-stream"], { binary: true }))).toEqual([
			["application/octet-stream", "binary", false],
		]);
		expect(servedAs(facts(["text/plain"], { textual: true }))).toEqual([
			["text/plain", "text", false],
		]);
	});
});
