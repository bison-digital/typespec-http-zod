/**
 * **A value as a JavaScript literal whose source is ASCII.**
 *
 * `JSON.stringify` is the right spelling for spec text that becomes code - a key, an enum value, a
 * media type, a description - because it quotes and escapes exactly as a string literal needs. It
 * leaves every other character as it is, and no file this package generates may carry one: a
 * consumer commits the output, and an invisible character in it has held a block comment open past
 * its terminator in the sibling package. `test/portability.test.ts` grades every emitted file.
 *
 * Measured once descriptions reached the output: `@typespec/http-specs`' `payload/xml` documents its
 * models as `"\u00a71.1 \u2014 Contains fields of primitive types."`, and the section sign and the dash went
 * straight into `schemas.gen.ts`. Every other site had the same exposure and was ASCII only because
 * no spec in the corpus happened to put a non-ASCII character in a key or a value.
 *
 * So every character outside printable ASCII is written as a `\uXXXX` escape: the same string at
 * run time, in either quote position, and in a TypeScript literal type. An astral character is two
 * UTF-16 units, escaped one at a time, which is how JavaScript spells it.
 */
export function literal(value: unknown): string {
	return escapeNonAscii(JSON.stringify(value));
}

/**
 * Every UTF-16 unit outside printable ASCII as a `\uXXXX` escape. A string literal and a regular
 * expression read the escape alike, with or without the `u` flag: under it, an escaped surrogate pair
 * is the one code point the pair spells.
 */
export function escapeNonAscii(source: string): string {
	return source.replace(/[^\x20-\x7e]/g, unicodeEscape);
}

/** One UTF-16 unit as `\uXXXX`. */
export function unicodeEscape(unit: string): string {
	return `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`;
}
