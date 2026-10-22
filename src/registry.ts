import {
	getDoc,
	getFriendlyName,
	type ModelProperty,
	type Program,
	type Type,
} from "@typespec/compiler";
import { getVisibilitySuffix, Visibility } from "@typespec/http";
import { firstReportOf } from "./constraints.js";
import { reportDiagnostic } from "./lib.js";
import {
	isSplitByVisibility,
	isSuffixedByUsage,
	viewRemedyOf,
	viewTemplateOf,
} from "./published.js";
import {
	propertyToTs,
	propertyTypeToTs,
	typeToTs,
	typeToTsBody,
	withTsRefResolver,
	withTsSyntheticDeclarations,
} from "./types.js";
import {
	captureBackEdges,
	currentVisibility,
	described,
	externalReferenceOf,
	isArrayLiteral,
	isOptionalAt,
	isSpeakableInstance,
	refuseExternalReference,
	type HeldDeclarations,
	type PropertyPosition,
	metadataAnnotationsIgnored,
	metadataInfoOf,
	multipartBinaryContext,
	noteBackEdge,
	OWN_POSITION,
	propertyToZod,
	renderedVisibilityOf,
	requestReadingAt,
	requestReadsApart,
	rootVisibilityOf,
	UNREPRESENTABLE,
	typeToZodBody,
	visibilityName,
	withDeclarationSite,
	withDeferredAnnotator,
	withMetadataAnnotationsIgnored,
	withMultipartBinary,
	withRefResolver,
	withRequestReadingAs,
	withHeldDeclarations,
	withSyntheticDeclarations,
	withParameterPosition,
	withVisibility,
} from "./zod.js";

/**
 * Assigns each named TypeSpec model/enum a single Zod declaration, emitted in dependency order.
 *
 * Without this, a model used by twelve operations is inlined twelve times: the generated file grows
 * quadratically, and - worse - the *type* it infers is a fresh structural type at each site, so a
 * client gets twelve `Book`s that are only accidentally the same. One declaration per model
 * is what makes the emitted types usable as a shared vocabulary rather than as twelve coincidences.
 */

/**
 * **A cycle with no property on its path - and it used to be refused.**
 *
 * **A recursive model is NOT this.** `model InnerModel { children?: InnerModel[] }` is an ordinary
 * tree - `@typespec/openapi3` publishes a self-`$ref` for it and the document is valid - so it is
 * emitted as a reference, made lazy by a getter on the property that closes the loop (see
 * `modelToZod`). What this handles is a cycle with no property to hang a getter on: a named **union**
 * whose variant refers back to a model still being rendered, or a dictionary VALUE that does.
 *
 * **`circular-model` claimed this was unrepresentable, and it was merely unimplemented.** Measured
 * on Zod 4.4.3, `z.lazy()` closes every one of these at run time - a union-variant cycle and a
 * dictionary-value cycle both parse nested values and, importantly, still **reject at depth**, so the
 * schema has not quietly degraded to something that accepts anything.
 *
 * **But `z.lazy()` alone does not TYPECHECK, and that is the whole difficulty.** Measured with
 * `tsc` under `strict`:
 *
 * ```
 * TS7022: 'branchSchema' implicitly has type 'any' because it does not have a type annotation
 *         and is referenced directly or indirectly in its own initializer.
 * TS7022: 'nodeSchema'   implicitly has type 'any' ...        <- it poisons the sibling too
 * ```
 *
 * Inferring `any` is worse than failing to compile, because `wire-contract.gen.ts` asserts
 * `Identical<z.infer<typeof X>, Contracts.X>` - against `any` that assertion PASSES while proving
 * nothing, which is the one outcome this package treats as worse than a red test.
 *
 * The fix is the recipe Zod documents: give the deferred declaration an explicit `z.ZodType<T>` and
 * declare `T` structurally. Measured, `tsc` exit 0 with the identity assertion still holding.
 *
 * **EVERY member of the cycle needs its structural type, not only the deferred one.** Leaving the
 * others as `export type X = z.infer<typeof xSchema>` reintroduces the loop through the annotation -
 * measured: `TS2456: Type alias 'Branch' circularly references itself` plus `TS2502` and `TS7022`. So
 * cycle membership, not merely deferral, decides which declarations are emitted structurally.
 */

interface Declaration {
	readonly identifier: string;
	readonly typeName: string;
	readonly source: string;
	/** The type declared, to tell one type in two contexts from two types of one name. */
	readonly type?: Type;
	/** The visibility it is declared at, to tell one type at two visibilities from two contexts. */
	readonly at?: Visibility;
	/**
	 * The structural TypeScript body for a declaration on a cycle, emitted INSTEAD of the
	 * `z.infer<typeof ...>` alias - which cannot be used here without closing the type-level loop.
	 */
	readonly structural?: string;
	/** Whether the declaration is annotated `: z.ZodType<typeName>`, which `z.lazy()` requires. */
	readonly annotated?: boolean;
	/** The registry key it was declared under, and its metadata context, to render it again. */
	readonly key?: string;
	readonly ignore?: boolean;
	/** The 3.0 request it is read for, to render it again - see `withRequestReading`. */
	readonly reading?: Visibility;
	/** A shape no type stands for, and the type it is published for - see `declareNamed`. */
	readonly synthetic?: Synthetic;
	/** The keys a merge in it asked to be refused, to render it again when one is - see `refusedAt`. */
	readonly consulted?: ReadonlySet<string>;
}

/** What a declaration no type stands for is: a multipart body, or a `@discriminated` envelope. */
interface Synthetic {
	readonly kind: "multipart" | "envelope";
	readonly site: Type;
}

/**
 * The words TypeScript refuses as the name of a declaration the emitted files write - a type alias,
 * an interface, and the references to each - in a module, which is strict mode.
 *
 * **A model may be named after one, and the corpus declares exactly that on purpose.** `special-words`
 * carries `await`, `break` and the rest, and this emitter wrote `export interface await { ... }` and
 * `export type break = z.infer<...>`, neither of which parses - `TS2427`, then the parser gives up
 * and the whole file is lost.
 *
 * **This is a LIST, which this package otherwise refuses.** It is defensible here because it is
 * not a list about this package's own code that drifts as the code changes: it is a closed set the
 * language fixes. The guard is that `test/declarationviews/names/` reads every keyword from the
 * scanner of the TypeScript this package builds with, measures which ones `tsc` refuses in each
 * position, and holds this set to exactly those - so a word missing here, or one renamed that need
 * not be, fails a test.
 *
 * **It is four groups, and only the first is ECMAScript's reserved words.** This docblock used to say
 * `interface`, `string`, `number`, `any`, `never` and `public` name a type without complaint; every
 * one of them is refused, and `export type object = ...` did not even load (`Type alias name cannot
 * be 'object'`). Measured against tsc 7.0.2 over the 84 keywords its scanner knows, as a model, an
 * enum and a union: 61 refused, the 61 below; the other 23 - `type`, `declare`, `module`, `of` and
 * the like - are legal everywhere the files write a name.
 *
 * - ECMAScript's reserved words, and `await` and `yield`, which a module reserves. `as` is contextual
 *   but `export type as = ...` is `TS1005`.
 * - The words strict mode reserves: `implements`, `interface`, `let`, `package`, `private`,
 *   `protected`, `public`, `static` - `TS1214`, since a module is strict.
 * - The predefined types, which no declaration may be named: `any`, `bigint`, `boolean`, `never`,
 *   `number`, `object`, `string`, `symbol`, `undefined`, `unknown` - `TS2457` and `TS2427`.
 * - The type operators, which do not parse where a type is referred to: `p?: keyof;` is `TS1110`,
 *   and so are `readonly` and `unique`; `infer` is `TS1003`.
 */
const RESERVED_DECLARATION_NAMES = new Set([
	// ECMAScript's reserved words, and the two a module reserves.
	"as",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"new",
	"null",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
	// Strict mode's.
	"implements",
	"interface",
	"let",
	"package",
	"private",
	"protected",
	"public",
	"static",
	// The predefined types.
	"any",
	"bigint",
	"boolean",
	"never",
	"number",
	"object",
	"string",
	"symbol",
	"undefined",
	"unknown",
	// The type operators.
	"infer",
	"keyof",
	"readonly",
	"unique",
]);

/**
 * **The names the emitted files declare for THEMSELVES, beside the spec's own declarations.**
 *
 * `requests.gen.ts` declares `Produced`, `Simplify`, `ByteStream` and its three lookups; `schemas.gen.ts`
 * declares `ResponseArm`. A model named after one of them was declared twice: `TS2300` for a type
 * alias, and for `WireInputs` or `WireOutputs` something worse, because two interfaces of one name
 * MERGE - the model's properties silently became members of the lookup. So a spec's model of that
 * name is renamed exactly as a reserved word is.
 *
 * Graded by `test/collisions/`, which reads the names an emitted file declares off the OUTPUT rather
 * than off this set, so a helper added later without a line here fails a test.
 */
const EMITTED_HELPER_NAMES = new Set([
	"ByteStream",
	"Produced",
	"ResponseArm",
	"SPEC_VOCABULARIES",
	"Simplify",
	"WireInputs",
	"WireOutputs",
	"WireReader",
	"WireReaders",
	"WireResults",
]);

/**
 * **Library types the emitted files name bare, so a spec's type of the name takes a trailing `_`** -
 * a multipart file's `arrayBuffer: () => globalThis.Promise<ArrayBuffer>`, a stream's `Uint8Array`
 * chunks.
 *
 * **Every library GENERIC a file names is written `globalThis.Record<...>`, `globalThis.Readonly<...>`
 * or `globalThis.Promise<...>` where it is written**, so a spec's own `model Record`, `Promise`,
 * `Readonly` or `Exclude` is declared under its name, as openapi3 publishes it, and shadows nothing.
 * This was a rewrite of each finished file instead - every `Record<` in a file declaring a `Record`
 * became `globalThis.Record<` - and a file's text is not only references: the spec's own text is in
 * it too. Measured beside `model Record`: `k?: "Record<k>"` became `z.literal("globalThis.Record<k>")`,
 * refusing the value the document accepts and accepting one it refuses; `@pattern("^Record<...")`,
 * a default and a `.describe()` were rewritten alike; and an enum's value `"Record<int32>"`, kept in
 * `vocabularies.gen.ts`, was rewritten in `requests.gen.ts`, so the wire contract did not compile. Only
 * the site writing a reference knows it is one.
 */
const LIBRARY_NAMES_WRITTEN_BARE = new Set(["ArrayBuffer", "Uint8Array"]);

/**
 * The name a declaration is emitted under, from the name the document publishes it under.
 *
 * A trailing `_` is appended where the spec's own name cannot be a TypeScript declaration, or is one
 * the emitted file already declares for itself. It is applied in ONE place so both walks agree:
 * `wire-contract.gen.ts` pairs a validator against a contract type by name, and a mangling applied to
 * one side only would break that assertion rather than the file.
 *
 * **Decided on the WHOLE name, visibility suffix included, and for every declaration.** It was
 * decided on the bare name before {@link nameAt} added the suffix, so `model WireReader` seen through a
 * PATCH, which openapi3 publishes as `WireReaderUpdate` - a name nothing in the files holds - was
 * `WireReader_Update` and `wireReader_UpdateSchema`. And a declaration no type stands for never
 * reached it: a multipart body `model public` was `export interface public` (`TS1214`), and a
 * `@discriminated union Wire` with a variant `inputs` declared its envelope `WireInputs` beside the
 * lookup of that name, and the two interfaces merged without a word.
 */
function safeDeclarationName(declared: string): string {
	/**
	 * **A character a component key cannot hold is `_`, as openapi3 writes the key**: `model Caf\u{e9}` is
	 * published as `Caf_`, its `createValidKey`. Written as declared, the name reached identifiers -
	 * `caf\u{e9}Schema`, `interface Caf\u{e9}` - in files this package keeps to printable ASCII, under a name the
	 * document does not use. `-` and `.`, which a key may hold and an identifier may not, are `_` too.
	 */
	const name = declared.replace(/[^A-Za-z0-9_]/g, "_");
	return RESERVED_DECLARATION_NAMES.has(name) ||
		EMITTED_HELPER_NAMES.has(name) ||
		LIBRARY_NAMES_WRITTEN_BARE.has(name)
		? `${name}_`
		: name;
}

/**
 * **The type a body is validated as: openapi3's effective payload type, at the body itself.**
 * openapi3 resolves every request, response and part body through `getEffectivePayloadType`: what is
 * left once metadata is set aside, matched to the model it all came from. `@body body: { ...Foo;
 * @header h: string }` is `$ref Foo`, `Pet & {}` is `$ref Pet`; validated as written, the first
 * required the header as a key and the second refused a subtype's own keys under sealing.
 */
function payloadTypeOf(program: Program, type: Type, payload: boolean, depth: number): Type {
	if (!payload || depth !== 0 || type.kind !== "Model") return type;
	return metadataInfoOf(program).getEffectivePayloadType(type, currentVisibility());
}

/**
 * A type earns a name when the spec gave it one - anonymous shapes stay inline where they are used.
 * The name the document publishes it under, before any visibility suffix: {@link nameAt} makes it
 * the name it is emitted under.
 */
function declaredNameOf(program: Program, type: Type): string | undefined {
	/**
	 * **`@friendlyName` names a declaration, as openapi3's `getOpenAPITypeName` reads it first.**
	 * Read as the declared name, `@friendlyName("Dog") model Cat` was validated as `Dog` by the
	 * validator named `catSchema`, and two models swapping names swapped validators.
	 */
	const named =
		type.kind === "Enum" || type.kind === "Union" ? getFriendlyName(program, type) : undefined;
	if (type.kind === "Enum") return named || type.name;
	/**
	 * A named union earns a declaration too.
	 *
	 * Without this a union request body is inlined at its use site, so it exports no type - and code
	 * importing the contract types and the wire assertions both pair a model with a schema **by
	 * name**. A cross-field rule modelled as a discriminated union would silently stop being checked
	 * at the boundary.
	 */
	// An instance openapi3 cannot name is written out where it is used - see `isSpeakableInstance`.
	if (type.kind === "Union") {
		return type.name === undefined || !isSpeakableInstance(type) ? undefined : named || type.name;
	}
	if (type.kind !== "Model") return undefined;
	// A list literal is written out where it is used - see `isArrayLiteral`; `Record<T>` is an
	// instance, and the standard library's own. A spec's model of either name is published by it.
	if (isArrayLiteral(program, type)) return undefined;
	if (type.name === "Record" && program.checker.isStdType(type)) return undefined;
	/**
	 * **An anonymous model is written out where it is used**, as openapi3 writes `{ ...Pet }`: the one
	 * it names is the model a body resolves to, its effective payload type - see `payloadTypeOf` -
	 * which is that model, not the copy. Named after its source anywhere else, a property typed
	 * `{ ...Pet }` was a discriminated base, and refused with `Pet` where `Pet` was split.
	 */
	if (type.name === "") return undefined;
	/**
	 * **A template INSTANTIATION carries the template's name, and it is not a declaration - unless
	 * `@friendlyName` gives it one of its own.**
	 *
	 * `Page<Book>` and `Page<Author>` are both called `Page`, so naming them would export one const
	 * called `pageSchema` per instance - the file does not compile, and if it did, one shape would
	 * validate every response.
	 * `@typespec/openapi3` inlines instantiations for the same reason.
	 *
	 * **But it stops inlining one that has been named, and this used to keep inlining it.** Its rule
	 * is `shouldInline` in `@typespec/openapi`, and the first thing that function does is
	 * `if (getFriendlyName(program, type)) return false`. Measured on
	 * `@friendlyName("{name}Box", T) model Box<T>` used as `Box<string>`: openapi3 publishes a
	 * component `stringBox` and refers to it with `$ref`, while this emitter wrote the object out
	 * inline. So the two artefacts disagreed about what has a name, which is the opposite of what
	 * this docblock used to claim, and `@friendlyName` - the remedy openapi3 names for an inline
	 * cycle, and the one {@link "inline-cycle"} names here - did nothing.
	 *
	 * Invisible until a spec uses a template; a paged-response envelope is the usual first one.
	 */
	if (type.templateMapper !== undefined) {
		const friendly = getFriendlyName(program, type);
		return friendly === undefined || friendly === "" ? undefined : friendly;
	}
	const friendly = getFriendlyName(program, type);
	return friendly === undefined || friendly === "" ? type.name : friendly;
}

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

/**
 * `duplicate-declaration`, once per name whichever walk meets it first, saying which of the three it
 * is: two types of one name; one model in two metadata contexts; or one model at two visibilities
 * openapi3 names alike - PATCH at `Update` and at `Update` with `Patch`, both `XUpdate`.
 */
function reportCollision(
	program: Program,
	name: string,
	first: {
		readonly type?: Type;
		readonly at?: Visibility;
		readonly typeName?: string;
		readonly synthetic?: Synthetic;
		readonly key?: string;
	},
	second: {
		readonly type?: Type;
		readonly at?: Visibility;
		readonly typeName?: string;
		readonly synthetic?: Synthetic;
		readonly key?: string;
	},
): void {
	const target = second.type ?? first.type ?? second.synthetic?.site ?? first.synthetic?.site;
	if (target === undefined || !firstReportOf(program, "duplicate-declaration", target, name))
		return;
	/**
	 * **A shape no type stands for, beside another under its name**: a multipart body, whose parts
	 * are text and files, and an envelope openapi3 names after its union and variant.
	 */
	const synthetic = first.synthetic ?? second.synthetic;
	if (synthetic !== undefined) {
		reportDiagnostic(program, {
			code: "duplicate-declaration",
			messageId: synthetic.kind,
			format: { name },
			target,
		});
		return;
	}
	// The declaration's own model: a copy the compiler makes for a payload has no source.
	if (first.type === second.type) {
		// A union published in a multipart part's binary context and outside it - see `withMultipartBinary`.
		const binary = (key: string | undefined): boolean => key?.endsWith("\u0000multipart") === true;
		if (binary(first.key) !== binary(second.key)) {
			reportDiagnostic(program, {
				code: "duplicate-declaration",
				messageId: "binary",
				format: { name },
				target,
			});
			return;
		}
		const visibilities =
			first.at !== undefined && second.at !== undefined ? [first.at, second.at] : undefined;
		if (visibilities === undefined || visibilities[0] === visibilities[1]) {
			reportDiagnostic(program, {
				code: "duplicate-declaration",
				messageId: "context",
				format: { name },
				target,
			});
			return;
		}
		/**
		 * **The request's own view is published apart**, which is the remedy where openapi3 writes one
		 * model at a request's visibility and at another: `D extends B` sent once in a create body is
		 * written at `Create` and, through `B`'s derived models, at `Read`.
		 */
		const view = visibilities
			.map((each) => viewTemplateOf(each))
			.find((template) => template !== undefined);
		reportDiagnostic(program, {
			code: "duplicate-declaration",
			messageId: "visibility",
			format: {
				name,
				first: visibilityName(visibilities[0] ?? Visibility.Read),
				second: visibilityName(visibilities[1] ?? Visibility.Read),
				remedy:
					view === undefined
						? "Use the model at one of the two - for a PATCH, one 'implicitOptionality' setting - or give one use a model of its own."
						: first.type === undefined
							? `Send the request its own '${view}<...>' view, which openapi3 publishes apart, or use the model at one of the two - for a PATCH, one 'implicitOptionality' setting.`
							: `Send the request its own view - ${viewRemedyOf(view, first.type)} and send it as the request's '@body' - which openapi3 publishes apart, or use the model at one of the two - for a PATCH, one 'implicitOptionality' setting.`,
			},
			target,
		});
		return;
	}
	/**
	 * **Which of four things made two types one name**, each told as it is: a validator is named for
	 * its type with the first letter lowered, so `Foo` and `foo` meet only there; a visibility suffix
	 * can spell another type's name, `Thing` at `Create` beside a `ThingCreate`; a character an
	 * identifier cannot hold is `_`, so `x-y` meets `x_y`; and a namespace is dropped. Every one was
	 * told as the last, in one namespace as in two.
	 */
	const declaredName = (type: Type | undefined): string =>
		type !== undefined && "name" in type && typeof type.name === "string" ? type.name : name;
	const names = [declaredName(first.type), declaredName(second.type)] as const;
	if (
		first.typeName !== undefined &&
		second.typeName !== undefined &&
		first.typeName !== second.typeName
	) {
		reportDiagnostic(program, {
			code: "duplicate-declaration",
			messageId: "cased",
			format: { name, first: first.typeName, second: second.typeName },
			target,
		});
		return;
	}
	const suffixed = [first, second].findIndex((each) => {
		const bare = each.type === undefined ? undefined : declaredNameOf(program, each.type);
		return bare !== undefined && safeDeclarationName(bare) !== name && each.at !== undefined;
	});
	if (suffixed !== -1) {
		reportDiagnostic(program, {
			code: "duplicate-declaration",
			messageId: "suffixed",
			format: {
				name,
				first: names[suffixed] ?? name,
				second: names[1 - suffixed] ?? name,
				at: visibilityName([first, second][suffixed]?.at ?? Visibility.Read),
			},
			target,
		});
		return;
	}
	// Two instances of one template: openapi3 names a union instance after its template alone.
	const template = (type: Type | undefined): unknown =>
		type !== undefined && "templateMapper" in type && type.templateMapper !== undefined
			? type.node
			: undefined;
	const instances =
		template(first.type) !== undefined && template(first.type) === template(second.type);
	reportDiagnostic(program, {
		code: "duplicate-declaration",
		messageId: instances ? "instances" : names[0] !== names[1] ? "renamed" : "default",
		format: { name, first: names[0], second: names[1] },
		target,
	});
}

/**
 * One model can need MORE THAN ONE declaration.
 *
 * **Keyed on `(type, visibility)`, because a model is not one shape.** `@visibility` and HTTP
 * metadata both mean the same declaration projects differently by position: `@typespec/openapi3`
 * emits `VisibilityModel` and `VisibilityModelCreate` as separate components for exactly this
 * reason. Keyed on the type alone, whichever position was walked first won and every other position
 * silently got its shape - measured on the corpus, one strict model carrying all six lifecycle
 * properties, so a create request was required to send read-only fields.
 *
 * The suffix rule is openapi3's: canonical (`Read`) keeps the bare name, and another visibility only
 * earns a suffix when the model is actually TRANSFORMED at it. Same rule, so the identifiers line up
 * with the component names the document publishes.
 */
/**
 * The visibility a type is actually DECLARED at, which is not always the one requested - see
 * `renderedVisibilityOf`, the one rule both registries name and render by.
 *
 * **A type not reshaped at this visibility IS the canonical declaration, not a copy of it.** Keying
 * on the requested visibility while only suffixing transformed types produced two cache entries
 * sharing one identifier and an emitted file that stopped parsing:
 * `Identifier 'colorSchema' has already been declared`. An enum is the same enum in a request
 * and a response; a union holding a model the request reshapes is not, and was declared once for
 * both - its response validating the create view - until unions were named by the same rule as
 * models, as openapi3 names them.
 *
 * **One rule for both registries.** The emitted assertion pairs a validator with a contract type BY
 * NAME, so a rule applied in one walk and paraphrased in the other is a pairing that silently
 * compares the wrong two things.
 */

/**
 * A declaration's name at a visibility: the bare name at canonical, and suffixed elsewhere only where
 * the type is used at more than one visibility - openapi3's own rule, so a model only ever sent in a
 * create body is `Holder` and not `HolderCreate`, as the document names it.
 *
 * The suffix is `@typespec/http`'s `getVisibilitySuffix`, called with `Visibility.Read` as the
 * canonical exactly as `@typespec/openapi3` calls it in `schema-emitter.ts`. Same function, same
 * argument, same usage rule, so these identifiers line up with the component names the document
 * publishes rather than merely resembling them.
 */
/**
 * **The visibility a type is rendered at, by where it is asked for.** An operation's own body,
 * parameter or response - asked for with no body being rendered - is collapsed as openapi3 collapses
 * a root, whatever kind of type it is; a type another refers to is reduced where openapi3 reduces a
 * reference. They differ for a list and a union expression, which openapi3 reduces at the root and
 * not below it.
 */
function visibilityAt(
	program: Program,
	type: Type,
	requested: Visibility,
	depth: number,
): Visibility {
	return depth === 0
		? rootVisibilityOf(program, type, requested)
		: renderedVisibilityOf(program, type, requested);
}

export function nameAt(bare: string, at: Visibility, type: Type, reading?: Visibility): string {
	/**
	 * **A 3.0 request's reading of a shared schema is named for the request**, `WidgetCreate` beside
	 * the `Widget` a response reads: the document publishes one component and OAS 3.0 reads it two
	 * ways - see `withRequestReading` - so the module declares both, the request's under the name
	 * openapi3 gives a view of the type at that visibility.
	 */
	if (reading !== undefined) {
		return safeDeclarationName(`${bare}${getVisibilitySuffix(reading, Visibility.Read)}`);
	}
	// Suffixed only where openapi3 suffixes it: used at more than one visibility - see `isSuffixedByUsage`.
	const suffixed = at !== Visibility.Read && isSuffixedByUsage(type);
	return safeDeclarationName(`${bare}${suffixed ? getVisibilitySuffix(at, Visibility.Read) : ""}`);
}

/**
 * **The 3.0 request a shared schema is read apart for here**, or `undefined`: only a type rendered at
 * `Read` is shared with a response, and only one reaching a required read-only property reads apart -
 * see `requestReadsApart`. A view openapi3 publishes for a request's own visibility drops read-only
 * properties already, and the shared types it holds are read apart as they are reached.
 */
function readingOf(program: Program, type: Type, at: Visibility): Visibility | undefined {
	const reading = requestReadingAt();
	return reading !== undefined && at === Visibility.Read && requestReadsApart(program, type, at)
		? reading
		: undefined;
}

function keyFor(type: Type, visibility: Visibility, reading?: Visibility): string {
	/**
	 * **Keyed on the named model, never a copy of it**: `@typespec/http` synthesises a fresh anonymous
	 * model per position, and two operations taking one body each hand over a copy. Both resolve to
	 * the model itself, their effective payload type - see `payloadTypeOf` - so the document's one
	 * `BodyModel` is one declaration, where two copies of it once emitted `bodyModelSchema` twice.
	 */
	// Inside an explicit `@body` a type can render differently - see `withMetadataAnnotationsIgnored`.
	const body = metadataAnnotationsIgnored() ? "\u0000body" : "";
	// And inside a multipart part's union holding raw `bytes` - see `withMultipartBinary`.
	const binary = multipartBinaryContext() ? "\u0000multipart" : "";
	// And a 3.0 request's reading of a shared schema - see `readingOf`.
	const request = reading === undefined ? "" : `\u0000request${String(reading)}`;
	return `${String(visibility)}\u0000${String((type as { name?: string }).name ?? "")}\u0000${identityOf(type)}${body}${binary}${request}`;
}

/** A stable per-type identity, since two models can share a name across namespaces. */
const identities = new WeakMap<object, number>();
let nextIdentity = 0;
function identityOf(type: Type): number {
	const existing = identities.get(type as object);
	if (existing !== undefined) return existing;
	nextIdentity += 1;
	identities.set(type as object, nextIdentity);
	return nextIdentity;
}

export class SchemaRegistry {
	readonly #program: Program;
	readonly #declarations = new Map<string, Declaration>();
	readonly #order: Declaration[] = [];
	/** Key -> the identifier it is *going* to bind, so a back edge can name a declaration in flight. */
	readonly #inProgress = new Map<string, string>();
	/** Keys on a cycle - every one needs a structural type rather than a `z.infer` alias. */
	readonly #cyclic = new Set<string>();
	/** Identifiers refused as two shapes under one name, which no dispatch may hold. */
	readonly #refused = new Set<string>();
	/** Declarations refused as `split-visibility`, which a `@oneOf` holding them holds to nothing. */
	readonly #withheld = new Set<string>();
	/** Every type name a refused identifier stood for: `Foo` and `foo` are both `fooSchema`. */
	readonly #refusedTypeNames = new Set<string>();
	/** Each type declared by another type's declaration, the two rendered alike under one name. */
	readonly #alike: { readonly type: Type; readonly identifier: string }[] = [];
	/**
	 * Inlined types currently being walked, by identity, against the number of declarations that were
	 * in flight when each was entered.
	 *
	 * **The count is what tells a real inline cycle from an ordinary recursive model.** `#inProgress`
	 * cannot serve on its own: it is keyed by declaration name and these types have none, which is
	 * the whole reason the cycle has nothing to point at. But `InnerModel[]` re-enters `Array<InnerModel>`
	 * on a perfectly ordinary recursion - array, then the model, then the model's own `children` - and
	 * that cycle closes through `InnerModel`, which IS a declaration and terminates it. Comparing the
	 * count is how this asks openapi3's question, `cycle.containsDeclaration`: if a declaration was
	 * entered since, the cycle has a name to close on and the walk may continue.
	 */
	readonly #inlineInProgress = new Map<Type, number>();
	/** How many bodies are being rendered - none, and the type asked for is an operation's own. */
	#depth = 0;

	constructor(program: Program) {
		this.#program = program;
	}

	/**
	 * The Zod expression for a type - a bare identifier once the type has a declaration, otherwise
	 * inline source. Declaring is depth-first so a model's dependencies are emitted above it, which is
	 * what lets the generated file be plain `const` declarations with no forward references.
	 */
	expressionFor(given: Type, payload = false): string {
		const type = payloadTypeOf(this.#program, given, payload, this.#depth);
		// Published as a reference to another document, with no schema to validate.
		const external = externalReferenceOf(type);
		if (external !== undefined) return refuseExternalReference(this.#program, type, external);
		const bare = declaredNameOf(this.#program, type);
		const requested = currentVisibility();
		/**
		 * Asked of the model a declaration stands for, as openapi3 asks it of the effective payload type:
		 * a spread body's copy holds only what the request sends, so it is reshaped by nothing, while the
		 * model it copies - its `@path` property payload at `Read` - is.
		 */
		const at = visibilityAt(this.#program, type, requested, this.#depth);
		if (bare === undefined) {
			/**
			 * **A back edge to an INLINED type is a cycle with no name to close it**, and following it
			 * is a stack overflow rather than a wrong answer: the compiler reports "Emitter crashed!
			 * This is a bug." Tracked by identity because there is no key to track it by.
			 */
			const entered = this.#inlineInProgress.get(type);
			if (entered !== undefined && this.#inProgress.size <= entered) {
				reportDiagnostic(this.#program, {
					code: "inline-cycle",
					format: { type: "name" in type && type.name !== undefined ? String(type.name) : "" },
					target: type,
				});
				return UNREPRESENTABLE;
			}
			this.#inlineInProgress.set(type, this.#inProgress.size);
			try {
				return this.#inline(type, at, undefined);
			} finally {
				this.#inlineInProgress.delete(type);
			}
		}
		/**
		 * **A type not reshaped at this visibility IS the canonical declaration - not a copy of it.**
		 *
		 * Keying on the requested visibility while only suffixing transformed types produced two cache
		 * entries sharing one identifier, and the emitted file stopped parsing:
		 * `Identifier 'colorSchema' has already been declared`. An enum is the same enum in a
		 * request and a response. Collapsing onto `Read` first is what makes the key and the name agree,
		 * and it is the same collapse openapi3 performs before naming a component.
		 */
		const reading = readingOf(this.#program, type, at);
		const key = keyFor(type, at, reading);
		const existing = this.#declarations.get(key);
		if (existing !== undefined) return existing.identifier;
		/**
		 * **A declaration already in flight is REFERENCED, not re-entered.**
		 *
		 * Returning the identifier is what turns a recursive model into the self-`$ref` the document
		 * publishes. The back edge is noted so the enclosing object knows to defer it behind a getter -
		 * and if nothing does, {@link captureBackEdges} below still sees it and the cycle is named.
		 */
		const pending = this.#inProgress.get(key);
		if (pending !== undefined) {
			noteBackEdge();
			/**
			 * **Every declaration currently in flight is ON this cycle**, and all of them need a
			 * structural type - not only the one that ends up deferred. `#inProgress` is exactly the path
			 * from the cycle's entry point down to here, so recording it wholesale is both correct and
			 * cheap. Recording only the deferred declaration leaves the others as `z.infer` aliases and
			 * closes the loop again at the type level - `TS2456`, measured.
			 */
			for (const inFlight of this.#inProgress.keys()) this.#cyclic.add(inFlight);
			return pending;
		}

		const name = nameAt(bare, at, type, reading);
		const identifier = `${lowerFirst(name)}Schema`;
		const { source, deferred, consulted } = this.#render(type, at, name, key, identifier);

		const declaration: Declaration = {
			identifier,
			typeName: name,
			source,
			type,
			at,
			key,
			ignore: metadataAnnotationsIgnored(),
			...(reading === undefined ? {} : { reading }),
			...(this.#cyclic.has(key) ? { structural: this.#structuralBodyOf(type, at) } : {}),
			...(deferred ? { annotated: true } : {}),
			...(consulted.size === 0 ? {} : { consulted }),
		};
		/**
		 * **Two different types can resolve to one identifier, and the module then does not parse.**
		 *
		 * The key is `(visibility, name, identity)`, so two models genuinely named the same in
		 * different namespaces are two entries - and both then emit `export const thingSchema`.
		 * Measured on a service declaring `Alpha.Thing` and `Beta.Thing`: the document published
		 * both components under their full names, the emitted module declared `thingSchema` twice,
		 * and `tsc` answered `TS2451: Cannot redeclare block-scoped variable` while `tsp compile`
		 * reported success.
		 *
		 * `duplicate-declaration` already existed for exactly this and already said exactly this, but
		 * only {@link TypeRegistry} raised it - so the contracts files were covered and
		 * `schemas.gen.ts`, which every consumer imports, was not. `@typespec/openapi3` reports the
		 * same class through `checkDuplicateTypeName`, and `@typespec/json-schema` through
		 * `duplicate-id`; neither resolves it for you, because only the author knows which name to
		 * change.
		 */
		const twin = this.#order.find((candidate) => candidate.identifier === identifier);
		/**
		 * **One declaration reached in two contexts that render it alike is one declaration.** A type
		 * under an explicit `@body` is keyed apart from the same type elsewhere, since the body can
		 * publish a `@header` as data; where nothing in it does, the two are the same text and the
		 * document's one component.
		 */
		if (twin !== undefined && twin.source === declaration.source) {
			this.#declarations.set(key, twin);
			// Another type of the name, rendered alike, is validated by it too - see `typeIdentifiers`.
			if (twin.type !== type) this.#alike.push({ type, identifier });
			return twin.identifier;
		}
		if (twin !== undefined) {
			reportCollision(this.#program, name, twin, declaration);
			/**
			 * **One name, one declaration, and it validates nothing.** Two differing shapes under one
			 * identifier was a module declaring it twice, which does not parse. The document holds one
			 * of them under the name and openapi3 refuses its own document for it, so neither is kept.
			 */
			const refused: Declaration = {
				identifier,
				typeName: name,
				source: UNREPRESENTABLE,
				...(twin.type === undefined ? {} : { type: twin.type }),
				...(twin.at === undefined ? {} : { at: twin.at }),
			};
			this.#order[this.#order.indexOf(twin)] = refused;
			for (const [other, value] of this.#declarations) {
				if (value === twin) this.#declarations.set(other, refused);
			}
			this.#declarations.set(key, refused);
			this.#refused.add(identifier);
			this.#refusedTypeNames.add(twin.typeName).add(name);
			if (twin.type !== undefined) this.#refuseEnvelopesOf(twin.type);
			this.#renderDispatchesHolding(identifier);
			return identifier;
		}
		this.#declarations.set(key, declaration);
		this.#order.push(declaration);
		this.#declareRelatives(type);
		return declaration.identifier;
	}

	/**
	 * A declaration's body, rendered with its key in flight so a reference back to it is a back edge.
	 *
	 * A back edge that survived the whole body reached this declaration by a path with no object
	 * property on it - a named union variant, or a dictionary value - so nothing could make it lazy
	 * and the emitted `const` would read itself while initialising. `z.lazy()` defers the whole body
	 * instead, which is the only place left to put the deferral once no property can hold it.
	 */
	#render(
		type: Type,
		at: Visibility,
		name: string,
		key: string,
		identifier: string,
	): {
		readonly source: string;
		readonly deferred: boolean;
		readonly consulted: ReadonlySet<string>;
	} {
		this.#inProgress.set(key, identifier);
		const consulted = new Set<string>();
		this.#consulted.push(consulted);
		const rendered = (() => {
			try {
				return captureBackEdges(() => this.#inline(type, at, name));
			} finally {
				this.#consulted.pop();
			}
		})();
		this.#inProgress.delete(key);
		if (
			rendered.value === UNREPRESENTABLE &&
			isSplitByVisibility(this.#program, type, at, metadataAnnotationsIgnored(), name)
		) {
			this.#withheld.add(identifier);
		}
		/**
		 * **The description goes on the declaration's own body, so the exported const IS the
		 * described schema.** Every reference then names that one instance, which is what keeps
		 * identity, `z.compile`'s clone (it inherits the description through its parent link) and
		 * Zod's `$ref` extraction all intact. Described at a reference instead, each use would be a
		 * fresh clone. A visibility projection carries the doc of the model it projects, as openapi3
		 * publishes one component for both.
		 */
		const body = rendered.deferred ? `z.lazy(() => ${rendered.value})` : rendered.value;
		const source = described(body, getDoc(this.#program, type));
		return { source, deferred: rendered.deferred, consulted };
	}

	/**
	 * **Every dispatch rendered before a subtype it holds was refused, rendered again without it.** A
	 * refusal is found where the second shape under one name is declared, and a base's dispatch can
	 * already hold the first: `z.discriminatedUnion` given the `z.never()` the refusal leaves throws
	 * on every parse, and the module does not typecheck. Each is rendered in its own context, its key
	 * in flight, so a reference back to it is still a back edge.
	 */
	/**
	 * **A union refused takes its envelopes with it.** openapi3 publishes each envelope wherever it
	 * publishes the union, under one name: where the union is two schemas under its one name, each
	 * envelope is too, and the document keeps the one written last - `DU7Y` with its `kind` and
	 * `value` optional, written from a PATCH - while its validator held the view it was first declared
	 * at, requiring both. Refused with the union, whose diagnostic says why; the contract types follow.
	 */
	#refuseEnvelopesOf(union: Type): void {
		for (const [index, declaration] of this.#order.entries()) {
			if (declaration.synthetic?.kind !== "envelope" || declaration.synthetic.site !== union)
				continue;
			if (declaration.source === UNREPRESENTABLE) continue;
			const refused: Declaration = { ...declaration, source: UNREPRESENTABLE };
			this.#order[index] = refused;
			for (const [other, value] of this.#declarations) {
				if (value === declaration) this.#declarations.set(other, refused);
			}
			this.#refused.add(declaration.identifier);
			this.#refusedTypeNames.add(declaration.typeName);
		}
	}

	/** What a value rendered here may ask of the declarations it refers to - see `HeldDeclarations`. */
	readonly #held: HeldDeclarations = {
		refused: (expression) => this.#refused.has(expression),
		annotated: (expression) =>
			this.#order.some(
				(declaration) => declaration.identifier === expression && declaration.annotated === true,
			),
		refusedAt: (type, at) => {
			const key = keyFor(type, at, readingOf(this.#program, type, at));
			this.#consulted.at(-1)?.add(key);
			const declared = this.#declarations.get(key);
			return (
				declared !== undefined &&
				(this.#refused.has(declared.identifier) || this.#withheld.has(declared.identifier))
			);
		},
		holdsRefusalAt: (type, at) => {
			const key = keyFor(type, at, readingOf(this.#program, type, at));
			this.#consulted.at(-1)?.add(key);
			const declared = this.#declarations.get(key);
			return declared !== undefined && this.#reachesRefusal(declared.identifier, new Set());
		},
	};

	/** Whether a declaration is refused, or its source refers to one that reaches a refusal. */
	#reachesRefusal(identifier: string, seen: Set<string>): boolean {
		if (seen.has(identifier)) return false;
		seen.add(identifier);
		if (this.#refused.has(identifier) || this.#withheld.has(identifier)) return true;
		const declaration = this.#order.find((each) => each.identifier === identifier);
		if (declaration === undefined) return false;
		return [...declaration.source.matchAll(/[A-Za-z_$][\w$]*/g)].some(
			([name]) => name !== identifier && this.#declares(name) && this.#reachesRefusal(name, seen),
		);
	}

	#declares(identifier: string): boolean {
		return this.#order.some((each) => each.identifier === identifier);
	}

	/** The keys each declaration in flight asked `refusedAt` of, innermost last. */
	readonly #consulted: Set<string>[] = [];

	/** What the contract types' walk asks of these declarations, so a merge is `never` on both sides. */
	get held(): HeldDeclarations {
		return this.#held;
	}

	#renderDispatchesHolding(identifier: string): void {
		const holds = new RegExp(`\\b${identifier}\\b`);
		const refusedKeys = new Set(
			[...this.#declarations]
				.filter(([, value]) => value.identifier === identifier)
				.map(([each]) => each),
		);
		// By index: rendering one again can declare more, which hold no refused subtype.
		for (let index = 0; index < this.#order.length; index += 1) {
			const held = this.#order[index] as Declaration;
			const { type, at, key } = held;
			if (type === undefined || at === undefined || key === undefined) continue;
			// A dispatch, or a `@oneOf` that now holds a refused member - see `holdsRefusedMember` -
			// directly or through the declarations it refers to.
			const dispatches =
				(held.source.includes("z.discriminatedUnion(") || held.source.includes("z.xor(")) &&
				(holds.test(held.source) || this.#reachesRefusal(held.identifier, new Set()));
			// A merge that asked before the refusal holds the shape it now refuses - see `refusedAt`.
			const merges = [...(held.consulted ?? [])].some((each) => refusedKeys.has(each));
			if (!dispatches && !merges) continue;
			const keys = [...this.#declarations]
				.filter(([, value]) => value === held)
				.map(([each]) => each);
			for (const each of keys) this.#declarations.delete(each);
			const { source, deferred, consulted } = withRequestReadingAs(held.reading, () =>
				withMetadataAnnotationsIgnored(held.ignore ?? false, () =>
					this.#render(type, at, held.typeName, key, held.identifier),
				),
			);
			const fresh: Declaration = {
				...held,
				source,
				...(deferred ? { annotated: true } : {}),
				consulted,
			};
			this.#order[index] = fresh;
			for (const each of keys) this.#declarations.set(each, fresh);
		}
	}

	/**
	 * Declare the BASE CHAIN a component's own declaration implies.
	 *
	 * **Reachability from an operation is not the same set the document publishes.** openapi3 emits
	 * a component for every base in an `allOf` chain whether or not an operation names it, so `Pet` and
	 * `Cat` - bases of a `Siamese` that IS named - had no validator at all while the document declared
	 * them.
	 *
	 * **Subtypes are deliberately NOT walked here, because nothing would be walking them.** A
	 * discriminated base renders as a dispatch over its subtypes - `z.discriminatedUnion`, beside the base
	 * itself - and rendering that already asks the registry for each one. A loop here looked load-bearing and was measured not to
	 * be: removing it left all 23 polymorphism and differential arms green.
	 *
	 * **Wrapped in {@link captureBackEdges} and the result discarded.** This call can land on a
	 * declaration still in flight - a subtype's base is, by construction, the model that asked for it -
	 * and that is not a reference in anyone's emitted expression. Letting the back edge escape would
	 * have the enclosing declaration report a cycle it does not have and emit `z.never()`.
	 */
	#declareRelatives(type: Type): void {
		if (type.kind !== "Model" || type.baseModel === undefined) return;
		const base = type.baseModel;
		captureBackEdges(() => this.expressionFor(base));
	}

	/**
	 * Declare a component the document publishes, at the visibility the walk is at, as a type
	 * another refers to - see `publishedComponents`. Nothing refers to it here, so a declaration
	 * still in flight is no back edge.
	 */
	declare(type: Type): void {
		this.#depth += 1;
		try {
			captureBackEdges(() => this.expressionFor(type));
		} finally {
			this.#depth -= 1;
		}
	}

	/**
	 * The Zod for a single property, constraints and optionality included.
	 *
	 * Used for path/query parameters, which are `ModelProperty`s that belong to no model - so they
	 * need the property-level walk rather than the type-level one, or `@minLength` on a path param
	 * would be documented and never enforced.
	 *
	 * **The property is where a refusal inside it points**, as a model's member is - see
	 * `withDeclarationSite`. A parameter is walked outside any model, so `@query a?: never[]` was
	 * reported at `<unknown location>:1:1`, the intrinsic's own place, which names nothing to edit.
	 */
	expressionForProperty(
		property: ModelProperty,
		position: PropertyPosition = OWN_POSITION,
	): string {
		return withParameterPosition(true, () =>
			withDeclarationSite(property, () => this.#parameter(property, position)),
		);
	}

	#parameter(property: ModelProperty, position: PropertyPosition): string {
		return withRefResolver(
			/**
			 * **Every candidate goes through {@link expressionFor}, including the ones with no name.**
			 *
			 * This used to return `undefined` for an undeclared type, which sent it straight to
			 * `typeToZodBody` and past the only place a cycle is detected. A template instantiation is
			 * undeclared - `declaredNameOf` returns undefined for one, matching openapi3's inlining -
			 * so `model Box<T> { next?: Box<T> }` walked into itself until the stack ran out.
			 * `expressionFor` renders an undeclared type through `#inline` exactly as before, and now
			 * also notices when it is already doing so.
			 */
			(candidate) => this.expressionFor(candidate),
			() =>
				withHeldDeclarations(this.#held, () => propertyToZod(this.#program, property, position)),
		);
	}

	/**
	 * A declaration for a shape the spec never wrote, under a name the document publishes.
	 *
	 * `@discriminated` with an envelope has no TypeSpec type for its wrapper - openapi3 synthesises
	 * one and publishes it as `PetWithEnvelopeCat`, so there is a component with no `Type` to key on.
	 * Keyed by name instead, and pushed in the same dependency-first order as everything else, so the
	 * envelope declarations land above the union that references them.
	 *
	 * `declareNamed` exposes the same seam to the route emitter, which needs it for a **multipart**
	 * body: the document publishes `MultiPartRequest` as a component, and there is no walkable type
	 * for it - the parts have to be assembled from `@typespec/http`'s own view of the payload.
	 */
	declareNamed(name: string, build: () => string, site: Type): string {
		return this.#declareSynthetic(name, build, { kind: "multipart", site });
	}

	#declareSynthetic(published: string, build: () => string, synthetic: Synthetic): string {
		// Under the rule every declaration's name is decided by - see `safeDeclarationName`.
		const name = safeDeclarationName(published);
		const key = `synthetic\u0000${name}`;
		const existing = this.#declarations.get(key);
		if (existing !== undefined) return existing.identifier;
		const identifier = `${lowerFirst(name)}Schema`;
		if (this.#inProgress.has(key)) return identifier;
		this.#inProgress.set(key, identifier);
		const source = build();
		this.#inProgress.delete(key);
		const declaration: Declaration = { identifier, typeName: name, source, synthetic };
		/**
		 * **A name a type already declares is the same collision as any other**: a model sent as JSON
		 * and as a multipart form, its JSON component declared first, declared `formSchema` twice, and
		 * the module did not parse. One rendered alike is the one declaration.
		 */
		const twin = this.#order.find((candidate) => candidate.identifier === identifier);
		if (twin !== undefined && twin.source === source) {
			this.#declarations.set(key, twin);
			return identifier;
		}
		if (twin !== undefined) {
			reportCollision(this.#program, name, twin, declaration);
			const refused: Declaration = { ...twin, source: UNREPRESENTABLE };
			this.#order[this.#order.indexOf(twin)] = refused;
			for (const [other, value] of this.#declarations) {
				if (value === twin) this.#declarations.set(other, refused);
			}
			this.#declarations.set(key, refused);
			this.#refused.add(identifier);
			this.#refusedTypeNames.add(twin.typeName).add(name);
			this.#renderDispatchesHolding(identifier);
			return identifier;
		}
		this.#declarations.set(key, declaration);
		this.#order.push(declaration);
		return identifier;
	}

	/**
	 * The structural TypeScript body for a type on a cycle.
	 *
	 * **The same walk `requests.gen.ts` uses, resolving named types to their NAMES rather than
	 * declaring them.** A cyclic declaration cannot take its type from `z.infer<typeof ...>` - that is
	 * the loop - so it needs a type written out. Every name this body references is declared in the
	 * same file either structurally (if it is on the cycle too) or as the ordinary `z.infer` alias (if
	 * it is not), so nothing further has to be emitted for it.
	 *
	 * Sharing `types.ts` rather than writing a second TypeScript renderer is what keeps the annotation
	 * agreeing with the validator: those two walks are already paired against each other by
	 * `wire-contract.gen.ts`, and a third spelling of "what this shape is" would be a third thing to
	 * drift.
	 */
	#structuralBodyOf(type: Type, at: Visibility): string {
		/**
		 * At the visibility the declaration is keyed on, as its body was rendered: read at the one it
		 * was requested at, a discriminated base reached from a create body annotated itself with
		 * `DogCreate`, a declaration nothing made.
		 */
		return withVisibility(at, () =>
			withParameterPosition(false, () =>
				withTsRefResolver(
					(candidate) => this.#typeNameOf(candidate) ?? this.#reducedBodyOf(candidate),
					() => typeToTsBody(this.#program, type),
				),
			),
		);
	}

	/**
	 * **A type with no declaration of its own is written out where openapi3 reduces it to**, as
	 * {@link TypeRegistry.expressionFor} writes it: `q?: Record<M4>` under a PATCH is a `Record`
	 * openapi3 renders at `Read`, its value `M4`. Walked at the PATCH, the annotation named
	 * `M4Update`, which nothing declares (`TS2552`). `undefined` where the visibility stands, so the
	 * walk goes on as it was.
	 */
	#reducedBodyOf(candidate: Type): string | undefined {
		const requested = currentVisibility();
		const at = renderedVisibilityOf(this.#program, candidate, requested);
		return at === requested
			? undefined
			: withVisibility(at, () => typeToTsBody(this.#program, candidate));
	}

	/**
	 * **The TypeScript name a reference resolves to is the one {@link expressionFor} declares it
	 * under**, visibility suffix included. Resolved by the bare name, a cycle through a model a
	 * request projects typed the projection's back edges by the READ shape: `NodeCreate`'s
	 * `children` became `Node[]`, which carries a property the request never sends, and the declared
	 * validator did not satisfy its own annotation (`TS2375`).
	 */
	#typeNameOf(candidate: Type): string | undefined {
		const bare = declaredNameOf(this.#program, candidate);
		if (bare === undefined) return undefined;
		const at = renderedVisibilityOf(this.#program, candidate, currentVisibility());
		return nameAt(bare, at, candidate, readingOf(this.#program, candidate, at));
	}

	/**
	 * Render `type` without consulting its own declaration, but letting nested types use theirs.
	 *
	 * **The "not itself" rule belongs to the TOP of the walk, not to every depth.** It used to live
	 * in the resolver, which is asked at every node - so a model reaching itself through a property
	 * was inlined again, and again: `type/array` and `type/dictionary` in the conformance corpus both
	 * declare `children?: InnerModel[]` and both died with
	 * `RangeError: Maximum call stack size exceeded`. Skipping the resolver once, here, is what makes
	 * a nested occurrence resolve to the identifier while the body still renders as a body.
	 */
	#inline(type: Type, at: Visibility, declared: string | undefined): string {
		// What openapi3 publishes with its properties read at another visibility - see `published.ts`.
		const ignore = metadataAnnotationsIgnored();
		if (isSplitByVisibility(this.#program, type, at, ignore, declared)) return UNREPRESENTABLE;
		this.#depth += 1;
		try {
			// A declaration is a component every use shares, a parameter's included.
			return declared === undefined
				? this.#body(type, at)
				: withParameterPosition(false, () => this.#body(type, at));
		} finally {
			this.#depth -= 1;
		}
	}

	/** A model's body renders its own properties, outside a part's binary union - see `withMultipartBinary`. */
	#body(type: Type, at: Visibility): string {
		return withMultipartBinary(multipartBinaryContext() && type.kind !== "Model", () =>
			this.#bodyAt(type, at),
		);
	}

	#bodyAt(type: Type, at: Visibility): string {
		return withVisibility(at, () =>
			withRefResolver(
				/**
				 * **Every candidate goes through {@link expressionFor}, including the ones with no name.**
				 *
				 * This used to return `undefined` for an undeclared type, which sent it straight to
				 * `typeToZodBody` and past the only place a cycle is detected. A template instantiation is
				 * undeclared - `declaredNameOf` returns undefined for one, matching openapi3's inlining -
				 * so `model Box<T> { next?: Box<T> }` walked into itself until the stack ran out.
				 * `expressionFor` renders an undeclared type through `#inline` exactly as before, and now
				 * also notices when it is already doing so.
				 */
				(candidate) => this.expressionFor(candidate),
				() =>
					withDeferredAnnotator(
						(property, position) => this.#deferredAnnotationOf(property, position),
						(variant) => this.#deferredTypeAnnotationOf(variant),
						() =>
							withSyntheticDeclarations(
								(name, build, site) =>
									this.#declareSynthetic(name, build, { kind: "envelope", site }),
								() => withHeldDeclarations(this.#held, () => typeToZodBody(this.#program, type)),
							),
					),
			),
		);
	}

	/**
	 * The Zod type a property emitted as a getter is annotated with, or `undefined` for none.
	 *
	 * **Written here because naming a type is this class's job.** The walk in `zod.ts` produces the
	 * getter; only the registry resolves a named type to the declaration that carries it, so only it
	 * can write `Record<string, InnerModel>` rather than inlining the model and recursing forever.
	 * `types.ts` is the same walk `propertyToTs` uses, so the annotation cannot drift from the type
	 * the wire contract compares against.
	 *
	 * **A DEFAULTED property is left unannotated.** `propertyToZod` emits `.default(...)` only where
	 * `defaultOf` could render the value and reports a diagnostic where it could not, so an annotation
	 * written here would have to predict that decision; predicting it wrongly would put a type on the
	 * getter that its own value does not satisfy. A recursive property carrying a default is the one
	 * shape this leaves as it was.
	 */
	#deferredAnnotationOf(property: ModelProperty, position: PropertyPosition): string | undefined {
		if (property.defaultValue !== undefined) return undefined;
		const declared = withTsRefResolver(
			(candidate) => this.#typeNameOf(candidate),
			() => propertyTypeToTs(this.#program, property, position),
		);
		const core = `z.ZodType<${declared}, ${declared}>`;
		const optional =
			!position.required && (property.optional || isOptionalAt(this.#program, property));
		return `: ${optional ? `z.ZodExactOptional<${core}>` : core}`;
	}

	/** The annotation for a deferred value no property declares - an envelope's variant. */
	#deferredTypeAnnotationOf(type: Type): string {
		const declared = withTsRefResolver(
			(candidate) => this.#typeNameOf(candidate),
			() => typeToTs(this.#program, type),
		);
		return `: z.ZodType<${declared}, ${declared}>`;
	}

	/** Every declaration, dependencies first. */
	declarations(): readonly Declaration[] {
		return this.#order;
	}

	/**
	 * **The identifier each type is declared under by its own component name** - see
	 * `EmittedService.typeSchemaNames`. That is the declaration a response reads, wherever one does:
	 * `Read` is never suffixed, so a view of the type (`WidgetCreate`) and a 3.0 request's reading of
	 * it are other declarations, and neither is the one a wrapping emitter resolves a value by. A
	 * multipart body is its model's, which the document publishes under the model's name as the form it
	 * is; an envelope is named for its union and variant, and is no type's own. A declaration that
	 * validates nothing is left out rather than published as a validator.
	 */
	typeIdentifiers(): ReadonlyMap<Type, string> {
		const found = new Map<Type, string>();
		const consider = (type: Type, declaration: Declaration): void => {
			if (this.#validatesNothing(declaration)) return;
			// A view, and a 3.0 request's reading, are named with a suffix - see `nameAt`.
			const bare = declaredNameOf(this.#program, type);
			if (bare === undefined || declaration.typeName !== safeDeclarationName(bare)) return;
			found.set(type, declaration.identifier);
		};
		for (const declaration of this.#order) {
			const { type, synthetic } = declaration;
			if (type !== undefined) consider(type, declaration);
			else if (synthetic?.kind === "multipart") consider(synthetic.site, declaration);
		}
		// By identifier, because the declaration a type shares can be rendered again since.
		for (const { type, identifier } of this.#alike) {
			const declaration = this.#order.find((each) => each.identifier === identifier);
			if (declaration !== undefined) consider(type, declaration);
		}
		return found;
	}

	/**
	 * **Rendered as `z.never()`, and described where it has a doc comment**, so its source is not always
	 * `UNREPRESENTABLE` itself: a model split by visibility keeps its description. A declaration refused
	 * as two shapes under one name is replaced by a bare `UNREPRESENTABLE`, so it is one of these too.
	 */
	#validatesNothing(declaration: Declaration): boolean {
		return (
			declaration.source === UNREPRESENTABLE ||
			declaration.source.startsWith(`${UNREPRESENTABLE}.describe(`)
		);
	}

	/** The names of the declarations that validate nothing, refused here or in the walk beneath. */
	refusedNames(): ReadonlySet<string> {
		return new Set([
			...this.#refusedTypeNames,
			...this.#order
				.filter((declaration) => declaration.source === UNREPRESENTABLE)
				.map((declaration) => declaration.typeName),
		]);
	}
}

export interface TsDeclaration {
	readonly name: string;
	/** `true` when the body is an object literal and can be emitted as an `interface`. */
	readonly isObject: boolean;
	/** `true` for an enum-derived alias - declared but not exported, see below. */
	readonly isVocabulary: boolean;
	readonly source: string;
	/** The type declared, to tell one type in two contexts from two types of one name. */
	readonly type?: Type;
	/** The visibility it is declared at - see {@link Declaration.at}. */
	readonly at?: Visibility;
	/** A shape no type stands for - see {@link Declaration.synthetic}. */
	readonly synthetic?: Synthetic;
}

/**
 * The same walk as {@link SchemaRegistry}, emitting plain TypeScript instead of Zod.
 *
 * Kept as a separate class rather than a mode on the schema registry because the two produce
 * different *kinds* of declaration - an `interface` versus a `const` - and their reference resolvers
 * hand back different text. Sharing {@link declaredNameOf} is the part that matters: a model named in
 * one artefact is named the same way in the other, so the emitted assertion can pair them by name.
 */
/**
 * Whether a rendered body is ONE object literal, and so may be emitted as an `interface`.
 *
 * **This was `source.startsWith("{") && !source.includes("} & ")`, which named the two shapes it had
 * met rather than the property it needed.** A discriminated union with an envelope renders as
 * `{ kind: "cat"; value: Cat; } | { kind: "dog"; value: Dog; }`: it starts with a brace and holds no
 * intersection, so it was emitted as `export interface PetWithEnvelope { ... } | { ... }`. An
 * interface cannot be a union, so the file did not parse at all - and that is the DEFAULT envelope,
 * the shape a spec gets from writing `@discriminated` and nothing else.
 *
 * Balanced braces answer the question actually being asked: an interface is valid exactly when the
 * whole body is a single `{...}`, whatever it contains. A composition operator cannot be missed,
 * because anything following the matching close brace fails the test whatever it happens to be.
 */
export function isSingleObjectLiteral(source: string): boolean {
	if (!source.startsWith("{")) return false;
	let depth = 0;
	let quoted = false;
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		// A property key may be quoted and may itself contain a brace, which is not a nesting one.
		if (quoted) {
			if (character === "\\") index += 1;
			else if (character === '"') quoted = false;
			continue;
		}
		if (character === '"') quoted = true;
		else if (character === "{") depth += 1;
		else if (character === "}") {
			depth -= 1;
			// Closing the outermost brace anywhere but at the very end means something follows it.
			if (depth === 0) return index === source.length - 1;
		}
	}
	return false;
}

export class TypeRegistry {
	readonly #program: Program;
	/**
	 * **Keyed on `(type, visibility)`, exactly as {@link SchemaRegistry} is, and for the same reason.**
	 *
	 * One model is not one shape. Keyed on the `Type` alone, whichever position was walked first won
	 * and every other position silently got its shape - measured on `type/model/visibility`, where a
	 * `GET` reached the model first and the create body's contract type came out carrying the read
	 * projection. The two registries pair BY NAME in the emitted assertion, so they have to agree
	 * about how many declarations there are before the pairing means anything.
	 *
	 * Both now go through the shared `renderedVisibilityOf` and {@link nameAt}: paraphrasing either
	 * rule in one walk is how a validator ends up compared against a type describing something else.
	 */
	readonly #declarations = new Map<string, TsDeclaration>();
	readonly #order: TsDeclaration[] = [];
	readonly #inProgress = new Map<string, string>();
	/**
	 * The same in-flight tracking {@link SchemaRegistry} keeps, for the same cycle and by the same
	 * rule. Guarding one walk and not the other left the Zod side reporting `inline-cycle` correctly
	 * and the TypeScript side still running off the stack immediately afterwards, which reads to a
	 * consumer as "Emitter crashed! This is a bug." rather than as the error that was raised.
	 * Reported only by the schema walk, so one spec does not produce the same complaint twice.
	 */
	readonly #inlineInProgress = new Map<Type, number>();
	/** How many bodies are being rendered - see the schema registry's. */
	#depth = 0;

	/** The validators' declarations, whose refusals a merge here holds to as theirs do. */
	readonly #held: HeldDeclarations;

	constructor(program: Program, held?: HeldDeclarations) {
		this.#program = program;
		this.#held = held ?? {
			refused: () => false,
			annotated: () => false,
			refusedAt: () => false,
			holdsRefusalAt: () => false,
		};
	}

	expressionFor(given: Type, payload = false): string {
		const type = payloadTypeOf(this.#program, given, payload, this.#depth);
		// Refused by the schema walk, which reports it - see `externalReferenceOf`.
		if (externalReferenceOf(type) !== undefined) return "never";
		const bare = declaredNameOf(this.#program, type);
		const requested = currentVisibility();
		/**
		 * Asked of the model a declaration stands for, as openapi3 asks it of the effective payload type:
		 * a spread body's copy holds only what the request sends, so it is reshaped by nothing, while the
		 * model it copies - its `@path` property payload at `Read` - is.
		 */
		const at = visibilityAt(this.#program, type, requested, this.#depth);
		if (bare === undefined) {
			const entered = this.#inlineInProgress.get(type);
			if (entered !== undefined && this.#inProgress.size <= entered) return "never";
			this.#inlineInProgress.set(type, this.#inProgress.size);
			try {
				return this.#inline(type, at, undefined);
			} finally {
				this.#inlineInProgress.delete(type);
			}
		}
		const reading = readingOf(this.#program, type, at);
		const key = keyFor(type, at, reading);
		const name = nameAt(bare, at, type, reading);
		const existing = this.#declarations.get(key);
		if (existing !== undefined) return existing.name;
		/**
		 * **No laziness is needed on this side, and no refusal either.** A TypeScript `interface`
		 * may refer to itself - `interface InnerModel { children?: InnerModel[] }` is the ordinary way
		 * to write a tree - so the name alone is the whole answer. The Zod registry has to defer the
		 * same edge behind a getter only because a `const` cannot read itself while initialising.
		 *
		 * The in-flight name is the SUFFIXED one, not the bare one: a recursive model reached at
		 * `Create` must refer to `ThingCreate`, or it self-references a declaration that is not the
		 * one being written.
		 */
		const pending = this.#inProgress.get(key);
		if (pending !== undefined) return pending;

		this.#inProgress.set(key, name);
		const source = this.#inline(type, at, name);
		this.#inProgress.delete(key);

		const declaration: TsDeclaration = {
			name,
			type,
			/**
			 * Only a plain object literal can be an `interface`. A permissive response is
			 * `{ ...pinned } & Record<string, unknown>`, and `export interface X { ... } & ...` does not parse -
			 * so an intersection is emitted as a type alias instead.
			 */
			isObject: isSingleObjectLiteral(source),
			/**
			 * **A vocabulary alias is NOT exported.**
			 *
			 * It restates a vocabulary enum's members from the spec, and the vocabularies artefact already
			 * exports the same names derived from the runtime tuples - exporting both collides on every
			 * one of them the moment the package re-exports this file.
			 *
			 * Restating rather than referencing is deliberate, and it is what makes the drift visible:
			 * the emitted **Zod** defers to the runtime tuple while this type says what the spec
			 * *declares*, so the two disagreeing is exactly the lie the document is telling. Referencing
			 * the contracts type instead would make every assertion pass and publish the lie unchecked:
			 * an enum could advertise a member that cannot occur while omitting one that does.
			 */
			isVocabulary: type.kind === "Enum",
			source,
			at,
		};
		this.#declarations.set(key, declaration);
		/**
		 * **Declared once per NAME, not once per `Type`, and the two are not the same thing.**
		 *
		 * `#declarations` is keyed on the `Type` object so a repeated reference resolves without
		 * re-walking. Visibility projection produces a DIFFERENT `Type` for the same declaration, so one
		 * model reached under two visibilities was emitted twice and the file did not compile:
		 * `parameters/body-optionality` declares one `model BodyModel` and `requests.gen.ts` carried two
		 * byte-identical `export interface BodyModel`, from a compile that reported success.
		 *
		 * **Identical is dropped; DIFFERING is a collision and must not be.** Two declarations sharing a
		 * name with different bodies are two different types that TypeScript can only express as one, so
		 * silently keeping the first would publish a contract for a type nothing checks. The document
		 * distinguishes them and this file cannot, which is a refusal rather than a choice.
		 */
		const sameName = this.#order.find((candidate) => candidate.name === declaration.name);
		if (sameName === undefined) {
			this.#order.push(declaration);
		} else if (sameName.source !== declaration.source) {
			// Refused as the schema registry refuses it - one declaration, of nothing.
			reportCollision(this.#program, declaration.name, sameName, declaration);
			const refused: TsDeclaration = { ...sameName, source: "never", isObject: false };
			this.#order[this.#order.indexOf(sameName)] = refused;
			for (const [other, value] of this.#declarations) {
				if (value === sameName || value === declaration) this.#declarations.set(other, refused);
			}
		}
		return declaration.name;
	}

	/** Declare a component the document publishes, as {@link SchemaRegistry.declare} does. */
	declare(type: Type): void {
		this.#depth += 1;
		try {
			this.expressionFor(type);
		} finally {
			this.#depth -= 1;
		}
	}

	/**
	 * The Zod-free type for a single property - used for path and query parameters, which are
	 * `ModelProperty`s belonging to no model. Without routing them through the registry a named model
	 * or enum in a parameter position is inlined rather than referenced.
	 */
	/** `wireName` names an HTTP parameter as the wire does - see {@link propertyToTs}. */
	expressionForProperty(property: ModelProperty, wireName?: string): string {
		return withParameterPosition(true, () =>
			withTsRefResolver(
				// Through expressionFor even when undeclared, so the cycle guard above is reachable.
				(candidate) => this.expressionFor(candidate),
				() =>
					// A refusal points at the property, as the schema walk's does.
					withDeclarationSite(property, () =>
						withHeldDeclarations(this.#held, () => propertyToTs(this.#program, property, wireName)),
					),
			),
		);
	}

	#inline(type: Type, at: Visibility, declared: string | undefined): string {
		// Refused as the schema registry refuses it, which reports it.
		const ignore = metadataAnnotationsIgnored();
		if (isSplitByVisibility(this.#program, type, at, ignore, declared)) return "never";
		this.#depth += 1;
		try {
			// A declaration is a component every use shares, a parameter's included.
			return declared === undefined
				? this.#body(type, at)
				: withParameterPosition(false, () => this.#body(type, at));
		} finally {
			this.#depth -= 1;
		}
	}

	/** A model's body renders its own properties, outside a part's binary union - see `withMultipartBinary`. */
	#body(type: Type, at: Visibility): string {
		return withMultipartBinary(multipartBinaryContext() && type.kind !== "Model", () =>
			this.#bodyAt(type, at),
		);
	}

	#bodyAt(type: Type, at: Visibility): string {
		return withVisibility(at, () =>
			withTsRefResolver(
				// Through expressionFor even when undeclared, so the cycle guard above is reachable.
				(candidate) => this.expressionFor(candidate),
				() =>
					withTsSyntheticDeclarations(
						(name, build, site) => this.#declareSynthetic(name, build, { kind: "envelope", site }),
						() => withHeldDeclarations(this.#held, () => typeToTsBody(this.#program, type)),
					),
			),
		);
	}

	/** A multipart body's type, under the component's name - see {@link SchemaRegistry.declareNamed}. */
	declareNamed(name: string, build: () => string, site: Type): string {
		return this.#declareSynthetic(name, build, { kind: "multipart", site });
	}

	/** A type for a shape the spec never wrote, as {@link SchemaRegistry.declareNamed} declares one. */
	#declareSynthetic(published: string, build: () => string, synthetic: Synthetic): string {
		// Under the rule every declaration's name is decided by - see `safeDeclarationName`.
		const name = safeDeclarationName(published);
		const key = `synthetic\u0000${name}`;
		const existing = this.#declarations.get(key);
		if (existing !== undefined) return existing.name;
		if (this.#inProgress.has(key)) return name;
		this.#inProgress.set(key, name);
		const source = build();
		this.#inProgress.delete(key);
		const declaration: TsDeclaration = {
			name,
			isObject: isSingleObjectLiteral(source),
			isVocabulary: false,
			source,
			synthetic,
		};
		// One name, one declaration, as the schema registry keeps it - see its `#declareSynthetic`.
		const twin = this.#order.find((candidate) => candidate.name === name);
		if (twin !== undefined && twin.source === source) {
			this.#declarations.set(key, twin);
			return name;
		}
		if (twin !== undefined) {
			reportCollision(this.#program, name, twin, declaration);
			const refused: TsDeclaration = { ...twin, source: "never", isObject: false };
			this.#order[this.#order.indexOf(twin)] = refused;
			for (const [other, value] of this.#declarations) {
				if (value === twin) this.#declarations.set(other, refused);
			}
			this.#declarations.set(key, refused);
			return name;
		}
		this.#declarations.set(key, declaration);
		this.#order.push(declaration);
		return name;
	}

	/** Every declaration, dependencies first. */
	declarations(): readonly TsDeclaration[] {
		return this.#order;
	}

	/**
	 * **A contract type whose validator validates nothing is `never` too**, whatever refused it: two
	 * shapes under one name, a union this emitter refuses, a model openapi3 publishes split. The wire
	 * assertion pairs the two by name, and a contract type stating a shape beside `z.never()` failed
	 * it - `interface HBase { name: string }` beside a refused `hBaseSchema`.
	 */
	refuse(names: ReadonlySet<string>): void {
		for (const [index, declaration] of this.#order.entries()) {
			if (!names.has(declaration.name) || declaration.source === "never") continue;
			const refused: TsDeclaration = { ...declaration, source: "never", isObject: false };
			this.#order[index] = refused;
			for (const [key, value] of this.#declarations) {
				if (value === declaration) this.#declarations.set(key, refused);
			}
		}
	}
}
