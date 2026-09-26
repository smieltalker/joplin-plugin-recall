// Builds the offline harnesses. tsconfig `paths` only redirects TYPE resolution,
// so the emitted `require('api')` still has to resolve at runtime — we drop a
// one-line shim into the output's node_modules that points at the stub.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.harness-build');
const tsc = path.join(root, 'node_modules', '.bin', 'tsc');

execFileSync(tsc, ['-p', path.join(root, 'tools', 'tsconfig.harness.json')], { stdio: 'inherit' });

const shimDir = path.join(out, 'node_modules', 'api');
fs.mkdirSync(shimDir, { recursive: true });
fs.writeFileSync(path.join(shimDir, 'index.js'), "module.exports = require('../../tools/apiStub.js');\n");
// `api/types` is real source (plain enums and interfaces, no imports), so it is
// compiled alongside and just needs pointing at.
fs.writeFileSync(path.join(shimDir, 'types.js'), "module.exports = require('../../api/types.js');\n");

console.log(`Harnesses built in ${path.relative(root, out)}/`);
console.log('  stats:   <dump> | node .harness-build/tools/statsHarness.js');
console.log('  preview: <dump> | node .harness-build/tools/previewHarness.js out.html src/webview/stats.css src/webview/stats.js');
