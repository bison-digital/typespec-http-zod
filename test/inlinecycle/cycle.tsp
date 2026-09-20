import "@typespec/http";

using Http;

/** A cycle closing through a TEMPLATE INSTANTIATION, which is inlined and so has no name to close on. */
@service(#{ title: "InlineCycle" })
namespace InlineCycle;

model Box<T> {
  value: T;
  next?: Box<T>;
}

model Holder {
  box: Box<string>;
}

@route("/holders")
@post
op echo(@body body: Holder): Holder;
