import "@typespec/http";
import "@typespec/versioning";

using Http;
using Versioning;

/**
 * A versioned service is emitted at its latest version, from types projected to it, so the map is
 * keyed by those projected types: the ones `EmittedService.operations` reaches.
 */
@versioned(Versions)
@service(#{ title: "Versioned names" })
namespace VersionedNames;

enum Versions {
  v1,
  v2,
}

@discriminator("kind")
model Fish {
  kind: string;
  @added(Versions.v2) age?: int32;
}

model Salmon extends Fish {
  kind: "salmon";
}

@removed(Versions.v2)
model Trout extends Fish {
  kind: "trout";
}

@route("/fish") @get op fish(): Fish;
