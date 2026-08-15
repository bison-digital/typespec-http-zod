import "@typespec/http";

using Http;

/**
 * Two parameterless operations: the shape every new consumer starts with.
 *
 * **A service with nothing to flatten still got `Simplify<T>` written into its contract types**, and
 * `noUnusedLocals` - which a generated file has to pass like any other - makes an unused type
 * declaration an error. Same class as the unconditional `z` and `zValidator` imports fixed in 0.7.0
 * and 0.9.0, and it bites on exactly the shape those did: a health check, before a spec has grown a
 * single request body.
 */
@service(#{ title: "Health" })
namespace Health;

model Status {
  ok: boolean;
}

@route("/health")
@get
op health(): Status;

@route("/ready")
@get
op ready(): Status;
