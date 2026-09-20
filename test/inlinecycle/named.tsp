import "@typespec/http";

using Http;

/** The same cycle, with the remedy the diagnostic names applied. */
@service(#{ title: "Named" })
namespace Named;

@friendlyName("{name}Box", T)
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
