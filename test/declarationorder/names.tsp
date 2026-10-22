import "./names.js";

using TypeSpec.Reflection;

namespace Augment;

/** Says nothing to this package: an annotation for some other emitter, naming an operation. */
extern dec names(target: Model, operation: Operation);
