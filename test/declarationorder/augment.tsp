// A second file whose only statement augments a model with an argument naming an operation. The
// compiler checks the argument when it checks `Widget`, so it meets `Gadgets` before the interfaces
// declared ahead of it.
import "./names.tsp";
import "./rest.tsp";

using Augment;
using Shop;

@@names(Widget, Gadgets.read);
