import "@typespec/http";
using Http;
namespace Other { union X { int32, X } }
@service namespace N { model M { x: int32 } @route("/a") op a(@body body: M): void; }
