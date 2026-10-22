import "@typespec/http";

using Http;

/**
 * **A description the document publishes is one the validator publishes too.**
 *
 * `@typespec/openapi3` writes every `@doc` and doc comment as a JSON Schema `description`: on a
 * component, on each property, and on a parameter object. The validators emitted from the same
 * source carried none, so a surface that publishes its input schema from them - an MCP server's
 * `tools/list` - handed a model calling a tool the bare patterns and enums with nothing saying what
 * a field is for, and a client checking the published schema before it calls refused what it could
 * not read.
 *
 * Each position below is one openapi3 treats distinctly. The undocumented ones are the controls.
 */
@service(#{ title: "Descriptions" })
namespace Descriptions;

/** A slug: lower-case words joined by dots or dashes, such as `science-fiction`. */
@pattern("^[a-z0-9]+(?:[.-][a-z0-9]+)*$")
scalar Slug extends string;

/** A slug narrowed to one section of the shop, documented in its own right. */
scalar SectionSlug extends Slug;

// No doc of its own, so it publishes the doc of the scalar it extends.
scalar InheritedSlug extends Slug;

/** The binding a book is printed in. */
enum Format {
  paperback,
  hardback,
}

/** Which edition a review is of. */
union Edition {
  "first",
  "later",
}

/** A review of a book, by one reader. */
model Review {
  /** The genre the review files under. */
  genre: Slug;

  inheritsScalarDoc: Slug;

  /** The property's own doc, which wins over the scalar's. */
  section: SectionSlug;

  inheritedChain: InheritedSlug;

  /** The headline of the review. */
  headline: string;

  plain: string;

  /** A genre that may be explicitly null. */
  nullableDocumented: Slug | null;

  nullableUndocumented: Slug | null;

  /** A note, which may be left out. */
  note?: string;

  /** How many times it was read, one if not said. */
  reads?: int32 = 1;

  /** The binding the reviewer read. */
  format?: Format;

  /** The edition reviewed. */
  edition?: Edition;

  /** The review this one answers, if any. */
  parent?: Review;

  @doc("A doc with \"quotes\", a back\\slash, a */ terminator,\nand a second line naming uriExpansion, explodedQuery, .pipe( and z.preprocess( as text.")
  tricky?: string;
}

/** A book on the shelf, with its reviews. */
model Book {
  /** The reviews, each of one reading. */
  reviews: Review[];

  /** The names on the cover. */
  authors: string[];

  /** The cover text, which only a write carries. */
  @visibility(Lifecycle.Create, Lifecycle.Update)
  blurb: string;
}

/** Shelves a book. */
@route("/books/{id}")
@put
op shelveBook(
  /** The book's id. */
  @path id: string,

  /** Only reviews in this genre. */
  @query filter?: Slug,

  /** Who is shelving. This text names uriExpansion and explodedQuery, which nothing here calls. */
  @header("x-caller") caller?: string,

  @body body: Book,
): Book;

/**
 * Reads one review.
 *
 * @param genre The genre the review files under.
 */
@route("/reviews/{genre}")
@get
op read(@path genre: Slug): Review;
