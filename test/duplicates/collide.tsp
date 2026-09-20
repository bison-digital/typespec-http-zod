import "@typespec/http";

using Http;

/** Two models genuinely named the same in different namespaces, which the document tells apart. */
@service(#{ title: "Collide" })
namespace Collide;

namespace Alpha {
  model Thing {
    a: string;
  }
}

namespace Beta {
  model Thing {
    b: int32;
  }
}

@route("/things")
interface Things {
  @post one(@body body: Alpha.Thing): Alpha.Thing;
  @put two(@body body: Beta.Thing): Beta.Thing;
}
