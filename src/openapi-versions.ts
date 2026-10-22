import type { Program } from "@typespec/compiler";

/**
 * **The OpenAPI versions `@typespec/openapi3` publishes from this compile**: its `openapi-versions`
 * option, read from the compile's options as `typespec-openapi-document` reads it, and openapi3's own
 * default, `3.0.0`, where nothing sets it - whether or not openapi3 is emitted, since a project
 * serving no document is still described by the one openapi3 would write.
 *
 * **The versions are two dialects, and a validator agrees with the one published.** 0.31.0 read every
 * schema as OpenAPI 3.1 reads it while openapi3 published 3.0 by default, and the two answer one
 * schema differently in two places: a required read-only property is required "on the response only"
 * at 3.0 and in both directions at 3.1, and 3.0's `nullable` takes effect only beside `type` - see
 * {@link publishesOpenApi30Only} and `unpublishable-null`.
 */
export function openApiVersionsOf(program: Program): readonly string[] {
	const options = program.compilerOptions.options?.["@typespec/openapi3"] as
		| { readonly "openapi-versions"?: readonly string[] }
		| undefined;
	const versions = options?.["openapi-versions"];
	return versions === undefined || versions.length === 0 ? ["3.0.0"] : versions;
}

const is30 = (version: string): boolean => version.startsWith("3.0.");

/** Whether every document openapi3 publishes here is OpenAPI 3.0, which reads a request as 3.0 does. */
export function publishesOpenApi30Only(program: Program): boolean {
	return openApiVersionsOf(program).every(is30);
}

/** Whether openapi3 publishes an OpenAPI 3.0 document here, beside any other. */
export function publishesOpenApi30(program: Program): boolean {
	return openApiVersionsOf(program).some(is30);
}

/** Whether openapi3 publishes OpenAPI 3.0 and a later version here, two documents a request reads apart. */
export function publishesOpenApi30AndLater(program: Program): boolean {
	const versions = openApiVersionsOf(program);
	return versions.some(is30) && versions.some((version) => !is30(version));
}
