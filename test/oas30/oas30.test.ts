import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { componentsAt30, schemaAt30, type Direction } from "../support/oas30.js";

/**
 * **The 3.0 reading is an oracle, so it is held to the specification it reads.** Every arm grading an
 * OpenAPI 3.0 document asks Ajv through `test/support/oas30.ts`; a rule it got wrong would grade a
 * validator against something no 3.0 document says. Each case below is one sentence of OAS 3.0.4,
 * with the 3.1 reading beside it where the two dialects answer differently - which is the whole reason
 * the reading exists.
 */

const ajv = new Ajv2020.default({ strict: false, validateFormats: false });

/** Whether a 3.0 schema, read for `direction`, accepts `value` - with `components` to resolve against. */
function at30(
	schema: object,
	value: unknown,
	direction: Direction = "response",
	components: Record<string, unknown> = {},
): boolean {
	const read = componentsAt30({ components: { schemas: components } }, direction);
	return ajv.validate({ ...(schemaAt30(schema, direction) as object), components: read }, value);
}

/** The same schema read as JSON Schema 2020-12, as a 3.1 document is. */
const at31 = (schema: object, value: unknown, components: Record<string, unknown> = {}): boolean =>
	ajv.validate({ ...schema, components: { schemas: components } }, value);

const INNER = { Inner: { type: "object", properties: { a: { type: "string" } } } };

describe("nullable", () => {
	it("admits null beside a type: 'A true value indicates that both null values and values of the type specified by type are allowed'", () => {
		expect(at30({ type: "string", nullable: true }, null)).toBe(true);
		expect(at30({ type: "string", nullable: true }, "a")).toBe(true);
		expect(at30({ type: "string" }, null)).toBe(false);
	});

	it("does nothing without one: it 'only takes effect if type is explicitly defined within the same Schema Object'", () => {
		expect(
			at30(
				{ allOf: [{ $ref: "#/components/schemas/Inner" }], nullable: true },
				null,
				"response",
				INNER,
			),
		).toBe(false);
	});

	it("leaves every other keyword to answer null: 'Other Schema Object constraints retain their defined behavior'", () => {
		expect(at30({ type: "string", enum: ["a", "b"], nullable: true }, null)).toBe(false);
		expect(
			at30(
				{ type: "object", allOf: [{ $ref: "#/components/schemas/Inner" }], nullable: true },
				null,
				"response",
				INNER,
			),
		).toBe(false);
		// Read as 3.1 reads the same keywords, the type array admits it - the difference.
		expect(at31({ type: ["string", "null"], enum: ["a", "b", null] }, null)).toBe(true);
	});
});

describe("a Reference Object", () => {
	it("ignores what is written beside it: 'any properties added SHALL be ignored'", () => {
		const pinned = { Pinned: { type: "string", maxLength: 1 } };
		const schema = { $ref: "#/components/schemas/Pinned", maxLength: 3, nullable: true };
		expect(at30(schema, "a", "response", pinned)).toBe(true);
		expect(at30(schema, "ab", "response", pinned)).toBe(false);
		expect(at30(schema, null, "response", pinned)).toBe(false);
		// 3.1 applies a sibling beside `$ref`, as JSON Schema 2020-12 does.
		expect(at31({ $ref: "#/components/schemas/Pinned", minLength: 1 }, "", pinned)).toBe(false);
	});
});

describe("the Schema Object's vocabulary", () => {
	it("drops a keyword 3.0 does not have, so it constrains nothing", () => {
		expect(at30({ const: "a" }, "b")).toBe(true);
		expect(at30({ type: "array", prefixItems: [{ type: "string" }] }, [1])).toBe(true);
		expect(at31({ const: "a" }, "b")).toBe(false);
	});

	it("reads exclusiveMinimum and exclusiveMaximum as the booleans that modify minimum and maximum", () => {
		expect(at30({ type: "number", minimum: 0, exclusiveMinimum: true }, 0)).toBe(false);
		expect(at30({ type: "number", minimum: 0, exclusiveMinimum: true }, 0.5)).toBe(true);
		expect(at30({ type: "number", maximum: 1, exclusiveMaximum: false }, 1)).toBe(true);
	});

	it("reads format: binary as unencoded octets, not a JSON string", () => {
		expect(at30({ type: "string", format: "binary" }, 1)).toBe(true);
		expect(at30({ type: "string", format: "byte" }, 1)).toBe(false);
	});
});

describe("readOnly and required", () => {
	const widget = {
		type: "object",
		required: ["id", "name"],
		properties: { id: { type: "string", readOnly: true }, name: { type: "string" } },
	};

	it("requires a read-only property 'on the response only'", () => {
		expect(at30(widget, { name: "a" }, "request")).toBe(true);
		expect(at30(widget, { name: "a" }, "response")).toBe(false);
		expect(at30(widget, { id: "1", name: "a" }, "request")).toBe(true);
	});

	it("reads it on a wrapped reference too, where openapi3 writes readOnly beside an allOf", () => {
		const wrapped = {
			type: "object",
			required: ["inner"],
			properties: {
				inner: { allOf: [{ $ref: "#/components/schemas/Inner" }], readOnly: true },
			},
		};
		expect(at30(wrapped, {}, "request", INNER)).toBe(true);
		expect(at30(wrapped, {}, "response", INNER)).toBe(false);
	});

	it("is an annotation at 3.1, where required holds both ways", () => {
		expect(at31(widget, { name: "a" })).toBe(false);
	});
});
