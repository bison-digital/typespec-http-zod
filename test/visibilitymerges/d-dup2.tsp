import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "dup2" }) namespace Dup2;
model Note { @visibility(Lifecycle.Create) secret?: string; n: string }
model NoteCreate { x: boolean }
model NoteLike { @visibility(Lifecycle.Create) secret?: string; n: string; z?: int32 }
model Base { x: Note }
model Sub extends Base { x: NoteLike }
@route("/n") @post op n(@body body: Note): Note;
@route("/nc") @post op nc(@body body: NoteCreate): void;
@route("/s") @post op s(@body body: Sub): Sub;
