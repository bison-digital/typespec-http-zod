import "@typespec/http";

using Http;

/**
 * **Two scalars whose `@encode` name each other.** Following the chain never reaches a type that
 * crosses the wire, so there is nothing to validate - and the walk that followed it overflowed the
 * stack, crashing the emitter (typespec-http-graphql, 2026-10-16). Used in a body, a parameter and a
 * header, which reach the chain through three different walks.
 */
@service(#{ title: "Encode cycle" })
namespace EncodeCycle;

@encode("x", Pong)
scalar Ping extends string;

@encode("x", Ping)
scalar Pong extends string;

/** A scalar encoded as itself is no cycle: the chain ends where it starts. */
@encode("y", Self)
scalar Self extends string;

model Thing {
  ping: Ping;
  self: Self;
}

@route("/t")
@get
op read(@query pong: Pong, @header("x-ping") ping: Ping): Thing;
