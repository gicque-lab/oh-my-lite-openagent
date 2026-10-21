// Production plugin entrypoint. All behavior lives in the SDK-neutral runtime
// plus the typed v1/v2 adapters (C03/C05); this file only re-exports the
// public surface so the installed path `.opencode/plugins/bounded-lite.ts`
// stays stable.
//
// Combined dual-host default export (PLUG-01, decision 4): one object with a
// stable `id`, v2 `setup()`, and v1 `server()` forwarding to the existing v1
// adapter. v1 hosts (1.18.29+) call `server`; v2 hosts validate the default
// export as `{ id, setup }` and call `setup`. Exactly one plugin instance,
// nine tools, either way.

import { Plugin } from "@opencode/plugin";
import {
  createBoundedLitePlugin,
  type V1PluginInput,
} from "../lib/compat/v1.js";
import { BOUNDED_LITE_PLUGIN_ID, setupBoundedLiteV2 } from "../lib/compat/v2.js";

const boundedLitePluginBase = {
  id: BOUNDED_LITE_PLUGIN_ID,
  // v1 hosts call server(input, options); forward to the typed v1 adapter.
  server: (input: V1PluginInput, options?: Record<string, unknown>) =>
    createBoundedLitePlugin(input, options),
  // v2 hosts call setup(context) on the default export.
  setup: setupBoundedLiteV2,
};

// Stable named exports for existing callers/tests: the v1 hooks factory and
// the combined dual-host object.
export {
  boundedLitePluginBase,
  boundedLitePluginBase as default,
  createBoundedLitePlugin,
  setupBoundedLiteV2,
};

export {
  type BoundedLitePluginOptions,
  type NormalizedBoundedLitePluginOptions,
  normalizePluginOptions,
} from "../lib/runtime/bounded-lite-core.js";
