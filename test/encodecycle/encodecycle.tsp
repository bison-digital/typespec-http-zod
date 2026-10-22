import "@typespec/http";

using Http;

/**
 * **Two scalars whose `@encode` name each other.** Following the chain never reaches a type that
 * crosses the wire, and the walk that followed it overflowed the stack, crashing the emitter. Each
 * is encoded as a scalar that is not standard, which openapi3 publishes with no type, so each is
 * refused at the first link. Used in a body, a parameter and a header, which reach the chain through
 * three different walks.
 */
@service(#{ title: "Encode cycle" })
namespace EncodeCycle;

@encode("x", Pong)
scalar Ping extends string;

@encode("x", Ping)
scalar Pong extends string;

/** A scalar encoded as itself is no cycle, and states no type either: openapi3 publishes `{ format: "y" }`. */
@encode("y", Self)
scalar Self extends string;

model Thing {
  ping: Ping;
  self: Self;
}

@route("/t")
@get
op read(@query pong: Pong, @header("x-ping") ping: Ping): Thing;
