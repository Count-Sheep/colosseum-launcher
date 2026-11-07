'use strict';

// The randomizer's settings, and what a save says about its run. The game does the choosing
// (host/randomizer.c in the port): a new save takes the setting, and keeps its seed from then on.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { newestPlain } = require('./gci-save');

// What can change, as the game's stamp holds it.
const OPTIONS = { randomizerStarters: 1, randomizerShadow: 2, randomizerTrainers: 4, randomizerGifts: 8, randomizerSimilar: 16, randomizerNoLegendaries: 32 };
const PARTS = 15;
const GENERATIONS = { randomizerGen1: 1, randomizerGen2: 2, randomizerGen3: 4 };

// The stamp, in a save's unscrambled slot: its place in the body, past where the body starts.
const STAMP = 8 + 0x1df80;
const STAMP_MAGIC = 0x43524e44;
const STAMP_VERSION = 1;
const CHECK = 0x5eedc01d;

const SAVE_FILE = 'pokemon_colosseum.dat';
const SPOILER_FILE = 'randomizer-spoiler.txt';

function newSeed() { return crypto.randomBytes(4).toString('hex').toUpperCase(); }

function normalizeSeed(input) {
  const seed = String(input ?? '').trim().toUpperCase();
  return /^[0-9A-F]{1,8}$/.test(seed) ? seed.padStart(8, '0') : '';
}

// The settings as they are kept: on, a seed once it's on, and at least one generation, as a run needs one.
function normalize(input = {}) {
  const settings = { randomizer: Boolean(input.randomizer), randomizerSeed: normalizeSeed(input.randomizerSeed),
    randomizerStarters: input.randomizerStarters !== false, randomizerShadow: input.randomizerShadow !== false,
    randomizerTrainers: input.randomizerTrainers !== false, randomizerGifts: input.randomizerGifts !== false,
    randomizerSimilar: Boolean(input.randomizerSimilar), randomizerNoLegendaries: Boolean(input.randomizerNoLegendaries),
    randomizerGen1: input.randomizerGen1 !== false, randomizerGen2: input.randomizerGen2 !== false, randomizerGen3: input.randomizerGen3 !== false };
  if (!settings.randomizerGen1 && !settings.randomizerGen2 && !settings.randomizerGen3)
    settings.randomizerGen1 = settings.randomizerGen2 = settings.randomizerGen3 = true;
  if (settings.randomizer && !settings.randomizerSeed) settings.randomizerSeed = newSeed();
  return settings;
}

function flags(settings, table) {
  return Object.entries(table).reduce((bits, [key, bit]) => (settings[key] ? bits | bit : bits), 0);
}

// COLO_RANDOMIZER for these settings, or null when a new save should be the normal game.
function environmentValue(settings) {
  const options = flags(settings, OPTIONS);
  if (!settings.randomizer || !settings.randomizerSeed || !(options & PARTS)) return null;
  return `${settings.randomizerSeed}:${options}:${flags(settings, GENERATIONS)}`;
}

// The run a save's unscrambled slot holds, or null for the normal game.
function runOf(plain) {
  if (plain.length < STAMP + 16 || plain.readUInt32BE(STAMP) !== STAMP_MAGIC || plain[STAMP + 4] !== STAMP_VERSION) return null;
  const options = plain[STAMP + 5], generations = plain[STAMP + 6], seed = plain.readUInt32BE(STAMP + 8);
  const expected = (seed ^ CHECK ^ (options << 8) ^ generations) >>> 0;
  if (plain.readUInt32BE(STAMP + 12) !== expected) return null;
  return { seed: seed.toString(16).toUpperCase().padStart(8, '0'), options, generations };
}

// What the save in a memory card folder is: { exists: false }, or whether it's a run and which.
function readSave(saveDirectory) {
  let data;
  try { data = fs.readFileSync(path.join(saveDirectory, SAVE_FILE)); }
  catch (_) { return { exists: false, run: null }; }
  try { return { exists: true, run: runOf(newestPlain(data).plain) }; }
  catch (_) { return { exists: false, run: null }; }
}

// readSave, read again only when the save file changes.
function createSaveReader() {
  let known = null;
  return saveDirectory => {
    let stamp = saveDirectory;
    try {
      const stat = fs.statSync(path.join(saveDirectory, SAVE_FILE));
      stamp += `:${stat.size}:${stat.mtimeMs}`;
    } catch (_) { stamp += ':none'; }
    if (known?.stamp !== stamp) known = { stamp, save: readSave(saveDirectory) };
    return known.save;
  };
}

// The game's spoiler log (what host/randomizer.c writes) as a player reads it. Teams' rows are
// left out: thousands of lines, and each trainer's turn to surprise.
function spoilerText(raw, species) {
  const nameOf = national => species.find(entry => entry.national === national)?.name || `#${national}`;
  const lines = String(raw).trim().split('\n'), [, seed] = (lines[0] || '').split(' ');
  const out = [`Pokémon Colosseum randomizer: seed ${seed}`, ''];
  const section = (title, kind, describe) => {
    const items = lines.map(line => line.split(' ')).filter(parts => parts[0] === kind);
    if (items.length) out.push(title, ...items.map(describe), '');
  };
  const swap = ([, was, now]) => `  ${nameOf(Number(was))} is now ${nameOf(Number(now))}`;
  section('Starters', 'starter', swap);
  section('Gifts', 'gift', swap);
  section('Shadow Pokémon', 'shadow', ([, , was, now]) => `  ${nameOf(Number(was))} is now ${nameOf(Number(now))}`);
  return out.join('\n');
}

function spoilerSeed(raw) { return (String(raw).match(/^seed ([0-9A-F]{8})/) || [])[1] || null; }

module.exports = { OPTIONS, GENERATIONS, SPOILER_FILE, newSeed, normalizeSeed, normalize, environmentValue, runOf, readSave, createSaveReader, spoilerText, spoilerSeed };
