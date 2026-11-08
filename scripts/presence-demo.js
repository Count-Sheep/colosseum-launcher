#!/usr/bin/env node
'use strict';

// Shows the launcher's Discord activity on the Discord app running on this computer, without the launcher.
//
//   node scripts/presence-demo.js                        a tour of what it shows, a step every 12 seconds
//   node scripts/presence-demo.js --game COLOSSEUM DISC  play: the game's own [presence] lines
//
// COLOSSEUM is a game build with host/presence.c (the port's build/colosseum), DISC your GC6E01 disc image.
// Ctrl+C clears the activity.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const discord = require('../src/discord');
const presence = require('../src/presence');

const STEP = 12000;
const startedAt = Date.now();

const base = { mode: 'field', story: 1, floor: 1, area: 1, place: 'OUTSKIRT STAND', opponent: '', lead: 'ESPEON', level: 25 };
const TOUR = [
  ['Starting up', { mode: 'boot', story: 0, floor: 0, area: 0, place: '' }],
  ['Title screen', { mode: 'menu', story: 0, floor: 900, area: 9, place: '' }],
  ['Outskirt Stand', {}],
  ['Battle', { mode: 'battle', floor: 200, area: 0, opponent: 'RIDER WILLIE' }],
  ['Phenac City', { floor: 3, area: 2, place: 'PHENAC CITY' }],
  ['Pyrite Town', { floor: 15, area: 3, place: 'PYRITE TOWN', lead: 'UMBREON', level: 31 }],
  ['Agate Village', { floor: 36, area: 4, place: 'AGATE VILLAGE' }],
  ['The Under', { floor: 47, area: 5, place: 'THE UNDER' }],
  ['Shadow Pokémon Lab', { floor: 65, area: 6, place: 'FRONT OF LAB' }],
  ['Mt. Battle', { floor: 74, area: 7, place: 'MT. BATTLE' }],
  ['Realgam Tower', { floor: 102, area: 8, place: 'REALGAM TOWER' }],
  ['Snagem Hideout', { mode: 'scene', floor: 129, area: 10, place: 'SNAGEM HIDEOUT' }],
  ['Battle Mode', { mode: 'battle', story: 0, floor: 126, area: 9, place: 'ORRE COLOSSEUM', opponent: 'CIPHER PEON SKRUB' }],
  ['Online battle', null]
];

const client = discord.createPresence({ log: message => console.log(`discord: ${message}`) });
function show(game, label, online = null) {
  const activity = presence.activity(game, { startedAt, online });
  client.set(activity);
  console.log(`${label ? `${label}: ` : ''}${activity.details || 'Pokémon Colosseum'}${activity.state ? ` | ${activity.state}` : ''}`
    + ` | ${activity.assets.large_image}`);
}

function stop(code = 0) {
  client.stop();
  console.log('Cleared the activity.');
  process.exit(code);
}
process.on('SIGINT', () => stop());

const found = discord.socketPaths().filter(target => process.platform === 'win32' || fs.existsSync(target));
console.log(found.length ? `Discord found: ${found[0]}` : 'Discord is not running on this computer; open it and this keeps looking.');
console.log('Your own profile shows the activity; the buttons only show to others.\n');

const args = process.argv.slice(2);
if (args[0] === '--game') {
  const [binary, disc] = args.slice(1);
  if (!binary || !disc) { console.error('usage: presence-demo.js --game COLOSSEUM DISC'); process.exit(2); }
  show(null, 'Game starting');
  const game = spawn(binary, [disc], { env: { ...process.env, COLO_PRESENCE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  let pending = '';
  game.stdout.on('data', chunk => {
    const lines = (pending + chunk).split('\n');
    pending = lines.pop();
    for (const line of lines) {
      const state = presence.parseLine(line.trim());
      if (state) show(state);
      else if (line.trim()) console.log(`game: ${line.trim()}`);
    }
  });
  game.on('close', code => { console.log(`Game exited (${code}).`); stop(); });
} else {
  let step = 0;
  const next = () => {
    const [label, fields] = TOUR[step++ % TOUR.length];
    if (fields === null) show(null, label, { opponent: 'Ash' });
    else show({ ...base, ...fields }, label);
  };
  next();
  setInterval(next, STEP);
}
