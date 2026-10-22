import "@typespec/http";

using Http;

@service(#{ title: "F4" })
namespace F4;

model Obj {
  a?: int32;
  b?: string;
}

@route("/l{/v}") @get op l(@path v: int32[]): void;
@route("/lx{/v*}") @get op lx(@path v: int32[]): void;
@route("/rx{/v*}") @get op rx(@path v: Record<int32>): void;
@route("/mx{/v*}") @get op mx(@path v: Obj): void;
@route("/ul{/v*}") @get op ul(@path v: (int32 | "all")[]): void;
@route("/optl{/v*}") @get op optl(@path v?: int32[]): void;
