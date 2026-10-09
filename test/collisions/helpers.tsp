import "@typespec/http";

using Http;

/**
 * Every helper the emitted files declare for themselves, triggered, and nothing else.
 *
 * Every name this spec declares carries a `Zq` prefix, so any other name declared at the top of an
 * emitted file is one the EMITTER chose - and a name the emitter chooses is a name some spec author
 * may already have given a model. `collisions.test.ts` reads those names off the output and then
 * compiles a spec declaring a model under each of them.
 */
@service(#{ title: "Helpers" })
namespace ZqHelpers;

model ZqThing {
  id: string;
}

@route("/things/{id}") @get op zqRead(@path id: string): ZqThing;

@route("/upload") @post op zqUpload(
  @header contentType: "application/octet-stream",
  @body body: bytes,
): ZqThing;
