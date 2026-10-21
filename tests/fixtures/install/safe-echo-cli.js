#!/usr/bin/env node
// Offline process-launch fixture used by tests/runtime/install.test.ts:
// exercises the same launch path the installer uses for the npm JavaScript CLI
// (process.execPath + argument array + shell:false). Prints everything it
// receives so tests can verify exact argument preservation, no shell
// interpolation, and failure propagation. Test scaffolding only.
const argv = process.argv.slice(2);

if (argv.includes("--exit-code-1")) {
  process.stderr.write("fixture requested exit 1\n");
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ argv })}\n`);
