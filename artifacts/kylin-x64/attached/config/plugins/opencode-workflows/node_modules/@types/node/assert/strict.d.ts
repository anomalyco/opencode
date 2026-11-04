declare module "assert/strict" {
    import { strict } from "node:assert";
    export = strict;
}
declare module "node:assert/strict" {
    import { strict } from "node:assert";
    export = strict;
}
