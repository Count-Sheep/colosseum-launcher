'use strict';

// Tool pins for tests, for a checkout whose toolset has not been published yet. Pins that exist are kept.
function TOOL_FIXTURE() {
  const fill = (manifest, keys) => {
    for (const [key, id] of Object.entries(keys)) {
      const name = `colo-build-tools-${id}-${manifest.toolset}`;
      manifest.platforms[key] ||= { toolset: manifest.toolset, name: `${name}.tar.gz`, url: `https://example.invalid/${name}.tar.gz`,
        sha256: '0'.repeat(64), size: 1 };
    }
  };
  fill(require('../src/tool-assets.json'), { linux: 'linux-x64', win32: 'windows-x64' });
  fill(require('../src/mac-tool-assets.json'), { x64: 'macos-x64', arm64: 'macos-arm64' });
}

module.exports = { TOOL_FIXTURE };
