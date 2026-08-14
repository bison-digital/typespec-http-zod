import "@typespec/http";
import "@typespec/openapi";
using Http;
using OpenAPI;

@service(#{ title: "Verify" })
namespace Verify;
model Thing { id: string; }

namespace A { @route("/a") interface Standard { @get primitive(@query p?: string): Thing; } }
namespace B { @route("/b") interface Standard { @get primitive(@query p?: string): Thing; } }
namespace C { @route("/c") interface Standard { @get primitive(@query p?: string): Thing; } }

// An explicit id: openapi3 neither deduplicates it nor reserves it.
namespace D { @route("/d") interface Standard { @operationId("Standard_primitive") @get primitive(@query p?: string): Thing; } }
