import "@typespec/http";

using Http;

/**
 * A cycle through a model a REQUEST projects: a property only a create sees makes the request's
 * version of the model a different declaration, `NodeCreate`, with its own structural type. (A
 * read-only property would not: openapi3 shares the canonical schema with it, `readOnly`.)
 *
 * The structural type and the getter's annotation named the type each reference resolves to by its
 * bare name, so `NodeCreate`'s `children` was typed `Node[]` - the READ shape, without the property
 * the request sends - and the declared validator did not satisfy its own annotation:
 * `TS2375`, in a file the compile reported as clean. Nothing in the corpus combines a cycle with
 * visibility.
 */
@service(#{ title: "projected cycle" })
namespace ProjectedCycle;

model Node {
  label: string;

  @visibility(Lifecycle.Create)
  token: string;

  parent?: Node;
  children: Node[];
}

@route("/nodes")
@post
op create(@body body: Node): Node;
