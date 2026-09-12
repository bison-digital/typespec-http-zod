import "@typespec/http";

using Http;

@service(#{ title: "Doc comments" })
namespace DocComments;

/** A model whose description stops at a link tag {@link Other} and loses the rest. */
model Linked {
  id: string;
}

/** A model whose description reaches an address at support@example.com and stops there. */
model Addressed {
  id: string;
}

model Property {
  /** A property naming @maxLength in prose, with no brace anywhere to notice. */
  id: string;
}

/** A model escaping the at-sign as \@link, which is upstream's own remedy. */
model Escaped {
  id: string;
}

/** A model backticking `{@link Other}` instead, which also survives. */
model Backticked {
  id: string;
}

/** A model with a brace in prose like { this }, which is not affected at all. */
model Braced {
  id: string;
}

/**
 * A model documenting its own parameters.
 *
 * @param id the identifier
 */
model Tagged {
  id: string;
}

@doc("A description set by the decorator, where {@link Other} is just characters.")
/** The comment beside it is not what gets published, so it must not be reported. */
model Decorated {
  id: string;
}

@route("/things")
@get
op list(): Linked[];

@route("/addressed")
@get
op listAddressed(): Addressed[];

@route("/property")
@get
op listProperty(): Property[];

@route("/escaped")
@get
op listEscaped(): Escaped[];

@route("/backticked")
@get
op listBackticked(): Backticked[];

@route("/braced")
@get
op listBraced(): Braced[];

@route("/tagged")
@get
op listTagged(): Tagged[];

@route("/decorated")
@get
op listDecorated(): Decorated[];
