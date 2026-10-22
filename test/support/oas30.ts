/**
 * **An OpenAPI 3.0 document, read as OAS 3.0.4 says, written as JSON Schema 2020-12 Ajv can run.**
 *
 * `@typespec/openapi3` publishes 3.0.0 unless a project asks for another version, and a 3.0 Schema
 * Object is not JSON Schema: it is a subset of an older draft with keywords of its own. Ajv knows none
 * of them, so a 3.0 document handed to it as it is would be graded by rules the document does not
 * follow. Each rule below is the specification's sentence, applied and nothing more:
 *
 * - **A Reference Object "cannot be extended with additional properties, and any properties added
 *   SHALL be ignored"**. A `$ref` keeps only itself.
 * - **The Schema Object is a fixed vocabulary**: the JSON Schema subset, the adjusted
 *   keywords, and `nullable`, `discriminator`, `readOnly`, `writeOnly`, `xml`, `externalDocs`,
 *   `example`, `deprecated`. A keyword outside it constrains nothing, so it is dropped.
 * - **`nullable` "only takes effect if `type` is explicitly defined within the same Schema Object"**,
 *   and then "Other Schema Object constraints retain their defined behavior, and therefore may disallow
 *   the use of `null` as a value." So `type: T` beside `nullable: true` is `type: [T, "null"]` and every
 *   other keyword is left to answer `null` as it would; without `type`, `nullable` is dropped.
 * - **`exclusiveMinimum` and `exclusiveMaximum` are booleans** modifying `minimum` and `maximum`, as in
 *   the JSON Schema draft 3.0 adopts; 2020-12 states the bound itself.
 * - **`format: binary` is "unencoded binary data"**, a body or a `multipart/*` part sent as octets, and
 *   not a JSON string: `type: string` beside it describes no JSON value, so the pair is any value, as
 *   3.1 writes it (`{}`, or `contentMediaType`). `byte` is the base64 string a JSON body carries.
 * - **A required read-only property is required "on the response only", and a required write-only one
 *   "on the request only"** (`readOnly`, `writeOnly`). So a schema is read for a direction: a request
 *   drops read-only properties from `required`, a response drops write-only ones. 3.1 made both
 *   annotations, which is the difference the 0.31.0 release missed.
 */

export type Direction = "request" | "response";

type Node = Record<string, unknown>;

/** OAS 3.0.4, Schema Object: the only keywords a 3.0 Schema Object has. */
const VOCABULARY = new Set([
	"title",
	"multipleOf",
	"maximum",
	"exclusiveMaximum",
	"minimum",
	"exclusiveMinimum",
	"maxLength",
	"minLength",
	"pattern",
	"maxItems",
	"minItems",
	"uniqueItems",
	"maxProperties",
	"minProperties",
	"required",
	"enum",
	"type",
	"allOf",
	"oneOf",
	"anyOf",
	"not",
	"items",
	"properties",
	"additionalProperties",
	"description",
	"format",
	"default",
	"nullable",
	"discriminator",
	"readOnly",
	"writeOnly",
	"xml",
	"externalDocs",
	"example",
	"deprecated",
]);

const isNode = (value: unknown): value is Node =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** One Schema Object, read for `direction`. */
export function schemaAt30(schema: unknown, direction: Direction): unknown {
	if (!isNode(schema)) return schema;
	if (typeof schema["$ref"] === "string") return { $ref: schema["$ref"] };
	const read = (child: unknown): unknown => schemaAt30(child, direction);
	const out: Node = {};
	for (const [keyword, value] of Object.entries(schema)) {
		if (!VOCABULARY.has(keyword)) continue;
		switch (keyword) {
			case "properties":
				out[keyword] = isNode(value)
					? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, read(child)]))
					: value;
				break;
			case "items":
			case "not":
				out[keyword] = read(value);
				break;
			case "additionalProperties":
				out[keyword] = typeof value === "boolean" ? value : read(value);
				break;
			case "allOf":
			case "anyOf":
			case "oneOf":
				out[keyword] = Array.isArray(value) ? value.map(read) : value;
				break;
			case "type":
			case "nullable":
			case "minimum":
			case "maximum":
			case "exclusiveMinimum":
			case "exclusiveMaximum":
			case "required":
				break;
			default:
				out[keyword] = value;
		}
	}
	if (schema["type"] === "string" && schema["format"] === "binary") {
		delete out["format"];
	} else if (typeof schema["type"] === "string") {
		out["type"] = schema["nullable"] === true ? [schema["type"], "null"] : schema["type"];
	}
	for (const [bound, exclusive] of [
		["minimum", "exclusiveMinimum"],
		["maximum", "exclusiveMaximum"],
	] as const) {
		const value = schema[bound];
		if (typeof value !== "number") continue;
		out[schema[exclusive] === true ? exclusive : bound] = value;
	}
	if (Array.isArray(schema["required"])) {
		const properties = isNode(schema["properties"]) ? schema["properties"] : {};
		const exempt = direction === "request" ? "readOnly" : "writeOnly";
		out["required"] = (schema["required"] as string[]).filter((name) => {
			const property = properties[name];
			return !(isNode(property) && property[exempt] === true);
		});
	}
	return out;
}

/** Every component schema of a 3.0 document, read for `direction`. */
export function componentsAt30(
	document: { components?: { schemas?: Record<string, unknown> } },
	direction: Direction,
): { schemas: Record<string, unknown> } {
	const schemas = document.components?.schemas ?? {};
	return {
		schemas: Object.fromEntries(
			Object.entries(schemas).map(([name, schema]) => [name, schemaAt30(schema, direction)]),
		),
	};
}
