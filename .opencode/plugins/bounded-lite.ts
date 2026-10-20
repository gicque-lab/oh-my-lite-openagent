// Production plugin entrypoint. All behavior lives in the SDK-neutral runtime
// plus the typed v1 adapter (C03); this file only re-exports the public surface
// so the installed path `.opencode/plugins/bounded-lite.ts` stays stable.
export {
  createBoundedLitePlugin as default,
  createBoundedLitePlugin,
} from "../lib/compat/v1.js";

export {
  type BoundedLitePluginOptions,
  type NormalizedBoundedLitePluginOptions,
  normalizePluginOptions,
} from "../lib/runtime/bounded-lite-core.js";
