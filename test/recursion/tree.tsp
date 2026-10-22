import "@typespec/http";

using Http;

/**
 * Recursive models, in the four shapes the emitter has to survive.
 *
 * The conformance corpus covers self-recursion through an array and through a dictionary
 * (`type/array`, `type/dictionary`, both `model InnerModel { children?: InnerModel[] }`). It does
 * **not** cover mutual recursion, and it declares no recursive model that is also sealed - so the
 * two things most likely to break are the two nothing was watching.
 */
@service(#{ title: "recursion" })
namespace Recursion;

/** Self-recursion through an array, and the model is sealed - the combination that has to be lazy. */
model TreeNode {
  label: string;
  children?: TreeNode[];
}

/** Self-recursion through a dictionary. */
model TreeIndex {
  label: string;
  byName?: Record<TreeIndex>;
}

/** Self-recursion through a bare property - no container between the model and itself. */
model Chain {
  label: string;
  next?: Chain;
}

/** Mutual recursion: neither model can be emitted before the other. */
model Author {
  name: string;
  books?: Book[];
}

model Book {
  title: string;
  author?: Author;
}

/**
 * A permissive recursive model, so the `.loose()` -> `z.looseObject` half of the switch is exercised.
 * Without this the loose arm is written and never run.
 */
model OpenNode {
  label: string;
  child?: OpenNode;
  ...Record<unknown>;
}

@route("/tree") op tree(@body body: TreeNode): TreeNode;
@route("/index") op index(@body body: TreeIndex): TreeIndex;
@route("/chain") op chain(@body body: Chain): Chain;
@route("/author") op author(@body body: Author): Author;
@route("/open") op open(@body body: OpenNode): OpenNode;
