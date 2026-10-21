// Dedicated directory entrypoint for OpenCode hosts (plan C01/C06 layout).
// Lives OUTSIDE the plugin auto-discovery directories (.opencode/plugins isn't
// implied by discovery here) so configured directory registration via the
// `./server` export resolves this single re-export: one default export
// (id + v2 setup + v1 server), exactly one plugin instance, nine tools.
// C06 packages this shim with the managed runtime manifest/lock.
export { default } from "./plugins/bounded-lite.js";
