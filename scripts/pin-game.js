'use strict';

// Points src/game-release.json at another game for a CI build: Beta's newest game (.github/workflows/build.yml).
// Never committed.
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'src', 'game-release.json');
const { OLDER_RENDERER } = require('../src/game-source');
const { COMMIT, DECOMP, RENDERER, RENDERER_DECOMP, VERSION } = process.env;
for (const [name, value] of Object.entries({ COMMIT, DECOMP, ...(RENDERER && { RENDERER, RENDERER_DECOMP }) }))
  if (!/^[0-9a-f]{40}$/.test(value || '')) throw new Error(`${name} must be a full commit hash, not "${value || ''}".`);
const game = JSON.parse(fs.readFileSync(file, 'utf8'));
Object.assign(game, { version: VERSION || 'ci', commit: COMMIT, decomp: DECOMP });
if (RENDERER) game.renderer = { ...OLDER_RENDERER, commit: RENDERER, decomp: RENDERER_DECOMP };
else delete game.renderer;
fs.writeFileSync(file, `${JSON.stringify(game, null, 2)}\n`);
process.stdout.write(`Building game ${game.version}: ${game.repository} ${COMMIT}\n`);
