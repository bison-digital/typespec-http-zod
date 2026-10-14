import "@typespec/http";

using Http;

/**
 * **A description the document publishes is one the validator publishes too.**
 *
 * `@typespec/openapi3` writes every `@doc` and doc comment as a JSON Schema `description`: on a
 * component, on each property, and on a parameter object. The validators emitted from the same
 * source carried none, so a surface that publishes its input schema from them - an MCP server's
 * `tools/list` - handed a model calling a tool the bare patterns and enums with nothing saying what
 * a field is for. One consumer counted 369 refusals against 98 accepted calls on one tool, most of
 * them from the client checking the published schema before it ever called.
 *
 * Each position below is one openapi3 treats distinctly. The undocumented ones are the controls.
 */
@service(#{ title: "Descriptions" })
namespace Descriptions;

/** A subject key: lower-case words joined by dots or dashes, such as `billing.invoice`. */
@pattern("^[a-z0-9]+(?:[.-][a-z0-9]+)*$")
scalar Subject extends string;

/** A subject narrowed to one area, documented in its own right. */
scalar AreaSubject extends Subject;

// No doc of its own, so it publishes the doc of the scalar it extends.
scalar InheritedSubject extends Subject;

/** How sure the agent is of a premise. */
enum Confidence {
  low,
  high,
}

/** Whether a check runs before or after the change lands. */
union Phase {
  "before",
  "after",
}

/** A premise an agent relies on when it declares a change. */
model Premise {
  /** What the premise is about. */
  subject: Subject;

  inheritsScalarDoc: Subject;

  /** The property's own doc, which wins over the scalar's. */
  area: AreaSubject;

  inheritedChain: InheritedSubject;

  /** What is claimed of the subject. */
  predicate: string;

  plain: string;

  /** A subject that may be explicitly null. */
  nullableDocumented: Subject | null;

  nullableUndocumented: Subject | null;

  /** A note, which may be left out. */
  note?: string;

  /** How many times it was checked, one if not said. */
  checks?: int32 = 1;

  /** How sure the declaring agent is. */
  confidence?: Confidence;

  /** When the check runs. */
  phase?: Phase;

  /** The premise this one refines, if any. */
  parent?: Premise;

  @doc("A doc with \"quotes\", a back\\slash, a */ terminator,\nand a second line naming uriExpansion, explodedQuery, .pipe( and z.preprocess( as text.")
  tricky?: string;
}

/** A declaration of intent, with the premises it rests on. */
model Declaration {
  /** The premises, each checked before the change may land. */
  premises: Premise[];

  /** The files the change will touch. */
  footprint: string[];

  /** When it was recorded, which only a read sees. */
  @visibility(Lifecycle.Read)
  recordedAt: utcDateTime;
}

/** Declares a change. */
@route("/declarations/{id}")
@put
op declareChange(
  /** The declaration's id. */
  @path id: string,

  /** Only premises about this subject. */
  @query filter?: Subject,

  /** Who is declaring. This text names uriExpansion and explodedQuery, which nothing here calls. */
  @header("x-caller") caller?: string,

  @body body: Declaration,
): Declaration;

/**
 * Reads one premise.
 *
 * @param subject The subject the premise is about.
 */
@route("/premises/{subject}")
@get
op read(@path subject: Subject): Premise;
