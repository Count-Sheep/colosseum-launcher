'use strict';

const $ = id => document.getElementById(id);
let current;
let changing = false;
let wizardStep = null;
let setupPending = false;
const GAME_LABEL = 'Play Pokémon Colosseum';
const activityLog = window.coloActivityLog.createActivityLog();
let logRenderPending = false;
let consoleOpen = false, consoleExpanded = false, consoleFollowing = true;
let consoleWasActive = false, consoleFailed = false;

function closeModal() {
  for (const dialog of document.querySelectorAll('.launcher-modal'))
    if (dialog.open) dialog.close();
}

// --- Pages: the tabs along the top pick one; Play is the home page. Each page can run code as it shows and hides.
const pages = {
  play: { section: 'page-home', nav: 'nav-play' }, saves: { section: 'page-saves', nav: 'nav-saves' },
  changelog: { section: 'changelog', nav: 'open-changelog' }, settings: { section: 'page-settings', nav: 'settings-cog' }
};
const pageOrder = Object.keys(pages);
let page = 'play';
const pageHooks = {};
function onPage(name, hooks) { pageHooks[name] = { ...pageHooks[name], ...hooks }; }
function showPage(name) {
  if (!pages[name]) return;
  if (name !== page && pageHooks[name]?.open?.() === false) return;
  const previous = page;
  if (name !== previous) {
    page = name;
    pageHooks[previous]?.hide?.();
  }
  for (const [key, item] of Object.entries(pages)) {
    $(item.section).hidden = key !== name;
    if (item.sub) continue;  // its tab is its parent page's
    const current = item.nav === pages[name].nav;
    $(item.nav).classList.toggle('active', current);
    if (current) $(item.nav).setAttribute('aria-current', 'page');
    else $(item.nav).removeAttribute('aria-current');
  }
  if (name !== previous) pageHooks[name]?.show?.();
  // An expanded log covers the page: picking one shrinks it back to the drawer.
  if (consoleExpanded) { consoleExpanded = false; setConsoleOpen(true); }
}
for (const [name, item] of Object.entries(pages)) if (!item.sub) $(item.nav).addEventListener('click', () => showPage(name));

// Settings is one page with a tab per section; it reopens on the last one shown.
const settingsTabs = ['gameplay', 'display', 'graphics', 'controls', 'manage', 'launcher'];
let settingsTab = 'gameplay';
function showSettingsTab(name) {
  if (settingsTab === 'controls' && name !== 'controls') stopCapture();
  settingsTab = name;
  for (const tab of settingsTabs) {
    $(`pane-${tab}`).hidden = tab !== name;
    $(`tab-${tab}`).setAttribute('aria-selected', String(tab === name));
    $(`tab-${tab}`).classList.toggle('active', tab === name);
  }
  $('settings-panes').scrollTop = 0;
  if (name === 'controls') { renderBindings(); loadGcAdapter(); }
}
for (const tab of settingsTabs) $(`tab-${tab}`).addEventListener('click', () => showSettingsTab(tab));
onPage('settings', {
  show() {
    showSettingsTab(settingsTab);
    $(`tab-${settingsTab}`).focus();
  },
  hide: () => stopCapture()
});

// --- Controls: key and controller bindings (src/bindings.js). keyBindings and padBindings hold only the
// controls the player changed.
let keyBindings = {};
let padBindings = {};
let bindingMode = 'keyboard';  // which kind the Controls page shows: 'keyboard' or 'controller'
let capture = null;  // { id, add } while waiting for a key or a controller button
let padPoll = 0;

function renderRange(key, off) {
  const value = Number($(key).value);
  $(`${key}-value`).textContent = off && !value ? off : `${value}%`;
}
for (const key of ['stickDeadzone', 'triggerClick']) {
  $(key).addEventListener('input', () => renderRange(key));
  $(key).addEventListener('change', () => saveSettings());
}
$('rumbleStrength').addEventListener('input', () => renderRange('rumbleStrength', 'Off'));
$('rumbleStrength').addEventListener('change', () => saveSettings());

function bindingNote() {
  return bindingMode === 'controller'
    ? 'Choose Change, then press a button on your controller, or hold two together, or pick the button from the list. Esc cancels. The sticks always move the sticks.'
    : 'Choose Change, then press a key. Esc cancels.';
}

// Whether the launcher sees a controller. Chromium shows one only after a button is pressed on it, and some
// it never shows (a Switch Pro Controller can be one), though the game reads them.
function padsSeen() { return [...(navigator.getGamepads ? navigator.getGamepads() : [])].some(Boolean); }

function stopCapture() {
  if (!capture) return;
  capture = null;
  window.removeEventListener('keydown', captureKey, true);
  cancelAnimationFrame(padPoll);
  $('binding-note').textContent = bindingNote();
  renderBindings();
}

// The buttons held right now on every connected controller (standard mapping), as "pad:index".
function heldPadButtons() {
  const held = new Set();
  for (const pad of (navigator.getGamepads ? navigator.getGamepads() : []))
    if (pad) pad.buttons.forEach((button, index) => {
      if (button.pressed || button.value > 0.6) held.add(`${pad.index}:${index}`);
    });
  return held;
}

// Waits for newly pressed controller buttons (ones already held when capture began do not count): two held
// together make a two-button binding (LB + LT), and one let go on its own is a binding by itself.
function watchPad(baseline, chord = []) {
  if (!capture) return;
  const held = heldPadButtons();
  for (const entry of held) {
    if (baseline.has(entry) || chord.some(item => item.entry === entry)) continue;
    const pad = ColoBindings.padFromIndex(Number(entry.split(':')[1]));
    if (pad) chord.push({ entry, pad });
  }
  const done = chord.length >= 2 || (chord.length === 1 && !held.has(chord[0].entry));
  if (done) {
    bindPad(chord.length >= 2 ? ColoBindings.padCombo(chord[0].pad, chord[1].pad) : chord[0].pad);
    return;
  }
  if (chord.length && capture) $('binding-note').textContent = `${ColoBindings.padLabel(chord[0].pad)}: let go, or press another button with it.`;
  for (const entry of [...baseline]) if (!held.has(entry)) baseline.delete(entry);  // released: may count when pressed again
  padPoll = requestAnimationFrame(() => watchPad(baseline, chord));
}

function captureKey(event) {
  // The controller button list takes its own keys (arrows, Enter); Esc still cancels.
  if (event.target?.classList?.contains('pad-choice') && event.code !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  if (event.code === 'Escape' && !event.shiftKey) { stopCapture(); return; }
  if (bindingMode === 'controller') return;  // waiting for a controller button
  const key = ColoBindings.keyFromCode(event.code);
  if (!key) { $('binding-note').textContent = 'The game cannot read that key. Try another, or Esc to cancel.'; return; }
  bindKey(key);
}

function bindKey(key) {
  const { id, add } = capture;
  const keys = add ? [...ColoBindings.keysFor(keyBindings, id).filter(item => item !== key), key] : [key];
  keyBindings = ColoBindings.normalize({ ...keyBindings, [id]: keys });
  stopCapture();
  saveSettings();
}

function bindPad(pad) {
  const { id, add } = capture;
  const pads = add ? [...ColoBindings.padsFor(padBindings, id).filter(item => item !== pad), pad] : [pad];
  padBindings = ColoBindings.normalizePads({ ...padBindings, [id]: pads });
  stopCapture();
  saveSettings();
}

// The controller's buttons to pick from while waiting for one, for a controller the launcher can't see.
function padChoice() {
  const list = document.createElement('select');
  list.className = 'pad-choice';
  list.setAttribute('aria-label', 'Controller button');
  const option = (value, text) => {
    const item = document.createElement('option'); item.value = value; item.textContent = text; return item;
  };
  list.append(option('', 'or choose…'), ...ColoBindings.PAD_BUTTONS.map(button => option(button.id, button.label)));
  list.addEventListener('change', () => { if (list.value) bindPad(list.value); });
  return list;
}

function startCapture(id, add) {
  stopCapture();
  capture = { id, add };
  window.addEventListener('keydown', captureKey, true);
  if (bindingMode === 'controller') {
    if (!padsSeen())
      $('binding-note').textContent = 'No controller found yet. Press any button on it, or pick the button from the list. Esc cancels.';
    watchPad(heldPadButtons());
  }
  renderBindings();
}

function renderBindings() {
  if (!globalThis.ColoBindings || $('pane-controls').hidden) return;
  const controller = bindingMode === 'controller';
  for (const button of document.querySelectorAll('[data-binding-mode]'))
    button.setAttribute('aria-pressed', String(button.dataset.bindingMode === bindingMode));
  const changed = controller ? padBindings : keyBindings;
  $('binding-list').replaceChildren(...ColoBindings.CONTROLS.map(({ id, label }) => {
    const row = document.createElement('div');
    row.className = `binding-row${changed[id] ? ' changed' : ''}${capture?.id === id ? ' capturing' : ''}`;
    const name = document.createElement('span'); name.textContent = label;
    const keys = document.createElement('span'); keys.className = 'binding-keys';
    const what = controller ? 'button' : 'key';
    const items = controller ? ColoBindings.padsFor(padBindings, id).map(ColoBindings.padLabel)
      : ColoBindings.keysFor(keyBindings, id).map(ColoBindings.keyLabel);
    const press = controller ? 'a button' : 'a key';
    if (capture?.id === id) {
      keys.textContent = controller && !padsSeen() ? 'No controller seen yet: press a button on it…'
        : capture.add ? `Press ${press} to add…` : controller ? 'Press a button, or two together…' : `Press ${press}…`;
      if (controller) keys.append(padChoice());
    } else if (!items.length) { keys.textContent = 'None'; keys.classList.add('binding-none'); }
    else keys.replaceChildren(...items.map(text => {
      const item = document.createElement('kbd'); item.textContent = text; return item;
    }));
    const actions = document.createElement('span'); actions.className = 'binding-actions';
    const button = (text, onClick, title) => {
      const item = document.createElement('button'); item.className = 'subtle'; item.textContent = text; item.title = title;
      item.disabled = Boolean(current?.active); item.addEventListener('click', onClick); return item;
    };
    actions.append(button('Change', () => startCapture(id, false), `Use one ${what} instead`),
      button('Add', () => startCapture(id, true), `Add another ${what}`));
    if (changed[id]) actions.append(button('Reset', () => {
      if (controller) { const { [id]: _removed, ...rest } = padBindings; padBindings = rest; }
      else { const { [id]: _removed, ...rest } = keyBindings; keyBindings = rest; }
      renderBindings(); saveSettings();
    }, `Back to the default ${what}s`));
    row.append(name, keys, actions);
    return row;
  }));
  // The button list takes focus, so the keyboard can pick from it too.
  if (capture && controller) $('binding-list').querySelector('.pad-choice')?.focus();
}

// GameCube adapter in Wii U mode (src/gc-adapter.js): shown while one is
// plugged in. The game reads it directly, so the controller bindings above and
// the launcher's own menus don't see it. On Linux the game needs a udev rule to
// open it; Allow access installs one.
function renderGcAdapter(status, message = '') {
  $('gc-adapter-note').hidden = !status?.present;
  if (!status?.present) return;
  const ready = 'The game reads it directly: plug the controller into any port (the first plugged port is player 1). It plays as on a GameCube, so the controller buttons set here and the launcher\'s menus don\'t apply to it.';
  $('gc-adapter-text').textContent = status.readable ? `Plugged in and ready. ${ready}`
    : status.fix === 'udev' ? 'Plugged in, but Linux doesn\'t let the game open it yet. Allow access adds a udev rule for it (as Dolphin needs), which asks for your password.'
    : status.fix === 'driver' ? 'Plugged in, but Windows has no working driver for it. Unplug it and plug it in again; if that doesn\'t help, choose USB Input Device for WUP-028 in Device Manager.'
    : 'Plugged in, but the game needs libusb to read it on a Mac. Install it with Homebrew: brew install libusb.';
  $('gc-adapter-actions').hidden = status.readable;
  $('gc-adapter-allow').hidden = status.fix !== 'udev';
  $('gc-adapter-copy').hidden = status.fix !== 'udev';
  $('gc-adapter-helper').textContent = message;
}
async function loadGcAdapter(message) {
  try { renderGcAdapter(await window.colo.gcAdapterStatus(), message); }
  catch (error) { renderGcAdapter({ present: true, readable: false }, error.message || String(error)); }
}
$('gc-adapter-check').addEventListener('click', () => loadGcAdapter());
$('gc-adapter-allow').addEventListener('click', async () => {
  $('gc-adapter-allow').disabled = true;
  try {
    const result = await window.colo.allowGcAdapter();
    renderGcAdapter(result.status, result.ok
      ? (result.status.readable ? 'Access allowed.' : 'The rule is installed. Unplug the adapter and plug it in again, then choose Check again.')
      : `Not changed: ${result.reason}. Copy the terminal command and run it in a terminal instead.`);
  } catch (error) { $('gc-adapter-helper').textContent = error.message || String(error); }
  finally { $('gc-adapter-allow').disabled = false; }
});
$('gc-adapter-copy').addEventListener('click', async () => {
  await window.colo.copyGcAdapterCommand();
  $('gc-adapter-helper').textContent = 'Copied. Paste it into a terminal, then unplug the adapter, plug it in again and choose Check again.';
});

$('reset-bindings').addEventListener('click', () => {
  stopCapture();
  if (bindingMode === 'controller') padBindings = {}; else keyBindings = {};
  renderBindings(); saveSettings();
});
for (const button of document.querySelectorAll('[data-binding-mode]'))
  button.addEventListener('click', () => {
    stopCapture();
    bindingMode = button.dataset.bindingMode;
    $('binding-note').textContent = bindingNote();
    renderBindings();
  });
for (const button of document.querySelectorAll('[data-close-modal]'))
  button.addEventListener('click', () => button.closest('dialog').close());

function showActivityLog() {
  closeModal();
  setConsoleOpen(true);
  const log = $('log');
  log.scrollTop = log.scrollHeight;
  log.focus();
}
// The activity log is a drawer under the page, opened from the status bar on any page. It pushes the
// page up rather than covering it; expanded, it takes the page's whole height.
function setConsoleOpen(open) {
  consoleOpen = open;
  if (!open) consoleExpanded = false;
  $('activity-log').hidden = !open;
  $('activity-log').classList.toggle('is-expanded', consoleExpanded);
  $('shell').classList.toggle('log-expanded', open && consoleExpanded);
  $('toggle-activity-log').classList.toggle('is-open', open);
  $('toggle-activity-log').setAttribute('aria-expanded', String(open));
  $('toggle-activity-log').title = open ? 'Hide activity log' : 'Show activity log';
  $('expand-activity-log').setAttribute('aria-pressed', String(consoleExpanded));
  $('expand-activity-log').setAttribute('aria-label', consoleExpanded ? 'Restore activity log' : 'Expand activity log');
  $('expand-activity-log').title = consoleExpanded ? 'Restore activity log' : 'Expand activity log';
  if (open && consoleFollowing) $('log').scrollTop = $('log').scrollHeight;
}
function setConsoleFollowing(follow) {
  consoleFollowing = follow;
  $('follow-activity-log').setAttribute('aria-pressed', String(follow));
  $('follow-activity-log').textContent = follow ? 'Following output' : 'Follow output';
  if (follow) $('log').scrollTop = $('log').scrollHeight;
}
$('toggle-activity-log').addEventListener('click', () => setConsoleOpen(!consoleOpen));
$('close-activity-log').addEventListener('click', () => setConsoleOpen(false));
$('expand-activity-log').addEventListener('click', () => {
  consoleExpanded = !consoleExpanded;
  setConsoleOpen(true);
});
$('follow-activity-log').addEventListener('click', () => setConsoleFollowing(!consoleFollowing));
$('log').addEventListener('scroll', () => {
  if (consoleOpen && consoleFollowing && $('log').scrollHeight - $('log').scrollTop - $('log').clientHeight > 24)
    setConsoleFollowing(false);
});
for (const id of ['view-build-log', 'view-activity-log', 'message-view-log'])
  $(id).addEventListener('click', showActivityLog);
$('message-close').addEventListener('click', () => setMessage(''));
$('save-activity-log').addEventListener('click', () => window.colo.saveActivityLog().catch(showError));
$('copy-activity-log').addEventListener('click', async () => {
  const button = $('copy-activity-log'), result = $('copy-log-result');
  button.disabled = true;
  button.textContent = 'Copy log';
  result.textContent = '';
  try {
    await window.colo.copyActivityLog();
    result.textContent = 'Full session copied.';
    button.textContent = 'Copied';
  } catch (error) {
    setConsoleOpen(true);
    result.textContent = `Could not copy log: ${errorText(error)}`;
  } finally {
    button.disabled = false;
  }
});

function setMessage(text, error = false) {
  const box = $('message');
  $('message-text').textContent = text || '';
  $('message-view-log').hidden = !error || !text;
  box.hidden = !text;
  box.classList.toggle('error', error);
  if (text && error) {
    consoleFailed = true;
    renderConsoleState(current?.active);
    setConsoleOpen(true);
  }
}

function badge(id, label, good = false, warn = false) {
  const element = $(id);
  element.textContent = label;
  element.className = `badge${good ? ' good' : warn ? ' warn' : ''}`;
}

function taskName(label) {
  if (!label) return 'Nothing running';
  if (label === GAME_LABEL) return 'Game running';
  if (label.startsWith('Build ')) return 'Setting up your game';
  if (label.startsWith('Download port') || label.startsWith('Download decomp') || label.startsWith('Download renderer')) return 'Downloading setup files';
  if (label.startsWith('Download build') || label.startsWith('Prepare build') ||
      label.startsWith('Unpack build') || label.startsWith('Update private')) return 'Preparing build tools';
  if (label === 'Install HD textures') return 'Downloading HD textures';
  if (label === 'Preview cleanup') return 'Checking removable files';
  if (label === 'Clean build output') return 'Freeing up space';
  return label;
}

function backupReason(reason) {
  return ({ manual: 'Manual backup', 'before-play': 'Before playing', 'after-play': 'After playing',
    'before-restore': 'Before restoring', 'before-cleanup': 'Before cleanup',
    'before-port-update': 'Before update', 'before-tools-change': 'Before changing build tools' })[reason] || 'Backup';
}

function needsTextureDownload(data) {
  return data.repoReady && !data.hdVisualsReady;
}

function requiredStep(data) {
  if (data.repoReady && data.romReady && (data.config.completedSetup || data.binaryReady)) return 0;
  if (!data.repoReady || !data.tools.ready) return 1;
  if (!data.romReady) return 2;
  if (!data.binaryReady || needsTextureDownload(data)) return 3;
  return 0;
}

function showWizardStep(data) {
  const required = requiredStep(data);
  if (required === 0) wizardStep = 0;
  else if (wizardStep === null || wizardStep === 0 || wizardStep > required) wizardStep = required;
  const ready = wizardStep === 0;
  const downloadTextures = ready && data.binaryReady && needsTextureDownload(data);
  $('page-home').classList.toggle('ready-mode', ready);
  $('setup-flow').hidden = ready;
  $('home-title').textContent = ready ? 'Pokémon Colosseum' : 'Set up your game';
  $('home-description').textContent = ready
    ? downloadTextures ? 'Set up HD visuals to finish setup.'
      : !data.binaryReady ? `This version of the game is not set up yet. Prepare & play gets it ready and starts it, or ▾ Prepare only gets it ready for later.`
      : data.game.needsUpdate ? `Game update${data.game.availableVersion ? ` ${data.game.availableVersion}` : ''} is ready. Your saves carry over.` : 'Ready when you are.'
    : "Three steps, then you're ready to play.";
  $('setup-install-description').textContent = data.config.settings.textures && !data.texturesInstalled
    ? "We'll download HD textures, then build a playable copy of the game on your computer. This can take a while."
    : "We'll build a playable copy of the game on your computer. This can take a while.";
  $('setup-download-title').textContent = data.repoReady ? 'Download build tools' : 'Download setup files';
  $('setup-download-description').textContent = data.repoReady
    ? 'The setup files are ready. Download the tools needed to prepare your game.'
    : "We'll get the files and tools needed to prepare your own disc. The game is not included.";
  const needsMacTools = data.platform.id === 'macos' && !data.tools.appleReady;
  $('mac-setup-help').hidden = !needsMacTools;
  $('mac-tools-settings').hidden = data.platform.id !== 'macos';
  // The build tools go to the launcher's data folder, not the install location: say where.
  $('tool-location-note').textContent = data.portable
    ? 'Setup files and tools download to the Colosseum-Launcher-Portable folder beside the launcher.'
    : needsMacTools ? 'This Mac needs Apple’s tools first. Open Mac setup help to get started.'
      : `Build tools (a few GB) download to ${data.toolsFolder || "the launcher's own folder"}${data.repoReady ? '' : ', not to the install location'}.`;
  if (needsMacTools) {
    $('setup-download-title').textContent = 'Prepare this Mac';
    $('setup-download-description').textContent = 'Check the tools needed before downloading and preparing your game.';
  }
  $('repo-location').hidden = data.repoReady;
  // The portable launcher keeps everything in its own folder, so there is no location to choose.
  $('choose-location').hidden = data.repoReady || data.portable;
  $('choose-repo-settings').hidden = data.portable;
  for (let step = 1; step <= 3; step++)
    $(`setup-step-${step}`).hidden = ready || step !== wizardStep;
  if (ready) $('play').textContent = downloadTextures
    ? setupPending || data.active?.label === 'Install HD textures' ? 'Setting up…' : 'Finish HD setup'
    : !data.binaryReady ? '▶  Prepare & play'
      : data.game.needsUpdate && data.config.settings.autoUpdate ? '↻  Update & play' : '▶  Play';
  else {
    $('step-count').textContent = `Step ${wizardStep} of 3`;
    document.querySelectorAll('.setup-progress-track i').forEach((segment, index) => {
      segment.classList.toggle('complete', index + 1 < wizardStep);
      segment.classList.toggle('current', index + 1 === wizardStep);
    });
    $('play').textContent = setupPending
      ? wizardStep === 1 ? 'Downloading…' : wizardStep === 2 ? 'Choosing…' : 'Setting up…'
      : wizardStep === 1 ? needsMacTools ? 'Set up Mac tools' : data.repoReady && data.tools.ready ? 'Continue'
        : data.repoReady ? 'Download build tools' : 'Download setup files'
        : wizardStep === 2 ? data.romReady ? 'Continue' : 'Choose disc image' : 'Begin setup';
  }
}

let playMenuOpen = false;
function renderPlayMenu(data) {
  const prepare = !data.binaryReady, update = data.game.needsUpdate && !prepare, hd = needsTextureDownload(data) && !prepare;
  const auto = data.config.settings.autoUpdate, next = data.game.availableVersion ? ` ${data.game.availableVersion}` : '';
  const name = 'the game';
  const [kind, label, detail] = prepare ? ['update', 'Prepare & play', `Set up ${name}, then start`]
    : hd ? ['hd', 'Finish HD setup', update && auto ? `Update to${next} and set up HD, then start` : 'Set up HD visuals, then start']
    : update && auto ? ['update', 'Update & play', `Install${next}, then start`]
      : ['play', 'Play', update ? 'Start without updating' : 'One player'];
  $('menu-default').dataset.kind = kind;
  $('menu-default-label').textContent = label;
  $('menu-default-detail').textContent = detail;
  $('menu-update-play').hidden = !update || auto;
  $('menu-update-play-detail').textContent = `Install${next}, then start`;
  $('menu-update-only').hidden = !update && !prepare;
  $('menu-update-only-label').textContent = prepare ? 'Prepare only' : 'Update only';
  $('menu-update-only-detail').textContent = prepare ? `Set up ${name}, play later` : `Install${next}, play later`;
  $('menu-play-now').hidden = !(update && auto) && !hd;
  const later = [update ? 'update' : '', hd ? 'HD visuals' : ''].filter(Boolean).join(' and ');
  $('menu-play-now-detail').textContent = `${later.charAt(0).toUpperCase()}${later.slice(1)} later`;
  $('play-menu-note').hidden = !update;
  const others = Object.entries({ 'menu-update-play': 'Update & play', 'menu-update-only': $('menu-update-only-label').textContent, 'menu-play-now': 'Play now' })
    .filter(([id]) => !$(id).hidden).map(([, item]) => item);
  // ▾ only when the menu has more than Play itself
  const offered = data.romReady && wizardStep === 0 && others.length > 0;
  $('play-more').hidden = !offered;
  $('play').classList.toggle('has-more', offered);
  $('play-more').disabled = Boolean(data.active) || setupPending;
  if (playMenuOpen && (!offered || $('play-more').disabled)) $('play-menu').hidePopover();
  $('play-more-hint').hidden = !offered || Boolean(data.active);
  $('play-more-hint').textContent = `▾ for ${others.join(' or ')}`;
}

// A task shows its progress under Play and in the status bar; the activity log opens by itself only
// when something fails (setMessage, appendLog).
function renderActivity(active) {
  if (active && !consoleWasActive) consoleFailed = false;
  consoleWasActive = Boolean(active);
  renderConsoleState(active);
  const working = Boolean(active) && active.label !== GAME_LABEL;
  $('task-progress').hidden = !working;
  $('status-progress').hidden = !working || !Number.isFinite(active.percent);
  if (!$('status-progress').hidden) $('status-progress-fill').style.width = `${active.percent}%`;
  $('activity-label').textContent = taskName(active?.label);
  $('stop').hidden = !active?.canStop;
  $('stop').textContent = active?.label === GAME_LABEL ? 'Stop game'
    : active?.label.startsWith('Build ') ? 'Stop build' : 'Stop task';
  $('view-build-log').textContent = active?.label.startsWith('Build ') ? 'View build log' : 'View activity';
  $('task-status').textContent = active ? taskName(active.label)
    : current?.binaryReady && needsTextureDownload(current) ? 'HD setup needed'
    : current?.game.needsUpdate && current.config.completedSetup ? 'Update ready'
    : $('page-home').classList.contains('ready-mode') ? 'Ready to play' : 'Finish setup to play';
  if (!working) return;
  $('progress-title').textContent = taskName(active.label);
  $('progress-detail').textContent = active.detail || 'Working…';
  const seconds = Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000));
  $('progress-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const known = Number.isFinite(active.percent);
  $('progress-percent').textContent = known ? `${active.percent}%` : '';
  $('progress-track').classList.toggle('indeterminate', !known);
  $('progress-fill').style.width = known ? `${active.percent}%` : '';
  if (known) $('progress-track').setAttribute('aria-valuenow', String(active.percent));
  else $('progress-track').removeAttribute('aria-valuenow');
}

function renderConsoleState(active) {
  const badge = $('console-state');
  badge.textContent = consoleFailed ? 'Error' : active ? 'Live' : 'Idle';
  for (const element of [badge, $('toggle-activity-log')]) {
    element.classList.toggle('is-live', Boolean(active) && !consoleFailed);
    element.classList.toggle('is-error', consoleFailed);
  }
}

function refresh(data) {
  if (Number.isFinite(data.logResetSequence)) resetLog(data.logResetSequence);
  current = data;
  const { config, platform } = data;
  $('platform').textContent = platform.name;
  $('repo-path').textContent = config.repo;
  $('repo-path').title = config.repo;
  $('settings-repo-path').textContent = config.repo;
  $('settings-repo-path').title = config.repo;
  $('choose-location').disabled = Boolean(data.active);
  $('update-port').disabled = !data.repoReady || Boolean(data.active);
  $('rom-path').textContent = data.romError || config.rom || 'No file selected';
  $('rom-path').title = data.romError || config.rom;
  $('rom-path').classList.toggle('rom-error', Boolean(data.romError));
  $('settings-rom-path').textContent = data.romError || config.rom || 'No disc file selected';
  $('settings-rom-path').title = data.romError || config.rom;
  $('choose-rom').hidden = !data.romReady;
  showWizardStep(data);
  renderMacTools(data.tools);
  $('play').disabled = Boolean(data.active) || setupPending;
  renderPlayMenu(data);
  for (const button of document.querySelectorAll('[data-setup-back]')) button.disabled = Boolean(data.active) || setupPending;
  $('build').hidden = !data.binaryReady || !data.romReady;
  $('rebuild-note').hidden = $('build').hidden;
  $('build').disabled = Boolean(data.active);
  const gb = bytes => (Math.ceil(bytes / 1e8) / 10).toFixed(1);
  const finish = data.binaryReady ? 'Close Settings and choose Finish HD setup.' : '';
  badge('textures-badge', data.texturesInstalled ? 'Installed' : 'Not installed', data.texturesInstalled,
    config.settings.textures && !data.texturesInstalled);
  $('texture-info').textContent = data.texturesInstalled
    ? config.settings.textures ? 'HD textures are ready.' : 'Already downloaded. Turn on to use them.'
    : `${config.settings.textures ? `${finish || 'HD textures will download during setup.'} ` : ''}About ${gb(data.texturePack.size)} GB to download; allow ${gb(data.texturePack.size + data.texturePack.unpacked)} GB of free space for setup.`;
  $('clean').disabled = !data.repoReady || Boolean(data.active);
  $('clean-preview').disabled = !data.repoReady || Boolean(data.active);
  // Windows only: elsewhere the game runs with libraries from the build tools. Your own MSYS2 is never removed.
  $('build-tools-row').hidden = platform.id !== 'windows' || data.tools.mode === 'own';
  $('build-tools-note').textContent = data.tools.ready
    ? 'Only needed to build the game, which plays without them. Removing them frees a few GB; the launcher downloads them again the next time it builds or sets up the game.'
    : 'Not downloaded. The launcher downloads them the next time it builds or sets up the game.';
  $('remove-build-tools').disabled = !data.tools.ready || !data.binaryReady || Boolean(data.active);
  $('choose-rom').disabled = Boolean(data.active);
  $('choose-rom-settings').disabled = Boolean(data.active);
  $('choose-repo-settings').disabled = Boolean(data.active);
  renderActivity(data.active);
  renderAppUpdate(data.appUpdate);
  const installedVersion = data.binaryReady ? data.game.installedVersion : null;
  const gameVersion = installedVersion || (data.binaryReady ? 'Version unavailable' : 'Not installed');
  $('version-summary').textContent = `Launcher v${data.game.launcherVersion} · Game ${installedVersion || (data.binaryReady ? 'version unavailable' : 'not installed')}`;
  $('launcher-version').textContent = `v${data.game.launcherVersion}`;
  $('installed-game-version').textContent = gameVersion;
  $('available-game-version-row').hidden = installedVersion === data.game.availableVersion;
  $('available-game-version').textContent = data.game.availableVersion;
  $('tool-version').textContent = data.game.toolVersion;
  $('tool-version-note').textContent = [data.tools.mode === 'own' ? 'Your MSYS2' : data.tools.ready || data.tools.privateInstalled ? 'Downloaded' : 'Not downloaded',
    data.game.installedToolVersion && data.game.installedToolVersion !== data.game.toolVersion
      ? `Game built with ${data.game.installedToolVersion}` : ''].filter(Boolean).join(' · ');
  $('game-update-note').textContent = !data.binaryReady
    ? `Game ${data.game.availableVersion} will be installed during setup.` : data.game.needsUpdate
    ? `Game ${data.game.availableVersion} is ready to set up. Your current version stays available until setup succeeds.`
    : 'Your game is up to date.';
  $('play-installed').hidden = !data.binaryReady || (!data.game.needsUpdate && !needsTextureDownload(data));
  $('play-installed').disabled = Boolean(data.active) || !data.romReady || setupPending;
  $('play-previous').hidden = !data.game.previousReady;
  $('play-previous').disabled = Boolean(data.active);
  $('save-path').textContent = `Saved games: ${data.saveDirectory}\nBackups: ${data.backupDirectory}`;
  $('backup-saves').disabled = Boolean(data.active);
  $('restore-saves').disabled = Boolean(data.active) || !data.backups.length;
  const selectedBackup = $('backup-list').value;
  $('backup-list').replaceChildren(...data.backups.map(backup => {
    const option = document.createElement('option');
    option.value = backup.id;
    option.textContent = `${new Date(backup.createdAt).toLocaleString()} · ${backupReason(backup.reason)} · ${backup.count} files`;
    return option;
  }));
  if (data.backups.some(backup => backup.id === selectedBackup)) $('backup-list').value = selectedBackup;
  $('backup-list').disabled = Boolean(data.active) || !data.backups.length;

  changing = true;
  $('renderer-field').hidden = !(platform.renderers || []).includes('vulkan');
  renderExclusiveResolutions(config.settings.exclusiveResolution);
  renderDisplays(config.settings.display);
  for (const key of SELECTS) $(key).value = String(config.settings[key]);
  renderRanges();
  for (const key of SWITCHES) $(key).checked = config.settings[key];
  renderTheme();
  keyBindings = config.settings.keyBindings || {};
  padBindings = config.settings.padBindings || {};
  $('stickDeadzone').value = String(config.settings.stickDeadzone ?? 10);
  $('triggerClick').value = String(config.settings.triggerClick ?? 85);
  $('rumbleStrength').value = String(config.settings.rumbleStrength ?? 100);
  renderRange('stickDeadzone');
  renderRange('triggerClick');
  renderRange('rumbleStrength', 'Off');
  for (const key of ['stickDeadzone', 'triggerClick', 'rumbleStrength']) $(key).disabled = Boolean(data.active);
  if (!capture) renderBindings();
  $('reset-bindings').disabled = Boolean(data.active);
  for (const key of [...SELECTS, ...SWITCHES]) $(key).disabled = Boolean(data.active);
  renderDependents(Boolean(data.active));
  changing = false;
}

// The settings that are a list or a range, and the ones that are a switch: each saves under its element's id.
const SELECTS = ['widescreen', 'resolution', 'frameRate', 'vsync', 'fullscreenMode', 'exclusiveResolution', 'display', 'msaa', 'anisotropic',
  'sharpen', 'brightness', 'aspect', 'presentFilter', 'fsrMode', 'textureLoading', 'renderer', 'hdText', 'padMode'];
const SWITCHES = ['fullscreen', 'hudEdges', 'skipMovies', 'overlay', 'backgroundInput', 'fxaa', 'textures', 'shaderWarmup', 'autoUpdate', 'autoBackups', 'darkMode'];

async function sync() { refresh(await window.colo.state()); }

function renderMacTools(tools) {
  const requirements = (tools.requirements || []).filter(item => !tools.managed || !item.package);
  if (tools.managed) requirements.push({ label: 'Launcher build tools', ready: tools.privateInstalled, automatic: true });
  $('mac-requirements').replaceChildren(...requirements.map(item => {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.label;
    const status = document.createElement('span');
    status.className = `badge${item.ready ? ' good' : item.optional ? '' : ' warn'}`;
    status.textContent = item.ready ? 'Ready' : item.automatic ? 'Download in Step 1' : item.optional ? 'Optional' : 'Needed';
    row.append(name, status);
    return row;
  }));
  const commands = (tools.commands || '').split('\n').filter(Boolean);
  $('mac-apple-command').replaceChildren();
  $('mac-extra-commands').replaceChildren();
  commands.forEach((command, index) => {
    const row = document.createElement('div');
    row.className = 'mac-command';
    const code = document.createElement('code');
    code.textContent = command;
    const copy = document.createElement('button');
    copy.className = 'subtle'; copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      try { await window.colo.copyMacCommand(index); copy.textContent = 'Copied'; }
      catch (error) { showError(error); }
    });
    row.append(code, copy);
    (command.startsWith('xcode-select') ? $('mac-apple-command') : $('mac-extra-commands')).append(row);
  });
  $('mac-apple-note').hidden = !commands.some(command => command.startsWith('xcode-select'));
  $('mac-extra-note').hidden = !commands.some(command => !command.startsWith('xcode-select'));
  $('mac-check-result').textContent = tools.appleReady || tools.ready ? 'Ready. Close this help and continue setup.'
    : tools.checked ? 'Some tools still need to be installed.' : 'Checking tools…';
}

// A Windows folder too deep to build the game in: the part of its path over
// the limit is marked, so players see how much shorter it must be.
function showPathProblem() {
  const problem = current?.pathProblem;
  if (!problem) return false;
  const over = problem.length - problem.limit;
  $('path-folder-name').textContent = problem.portable ? 'The Colosseum-Launcher-Portable folder' : 'The folder holding the setup files';
  $('path-length').textContent = problem.length;
  $('path-limit').textContent = problem.limit;
  const mark = document.createElement('mark');
  mark.textContent = problem.folder.slice(problem.limit);
  $('path-folder').replaceChildren(problem.folder.slice(0, problem.limit), mark);
  $('path-over').textContent = `${over} character${over === 1 ? '' : 's'} too long`;
  $('path-steps').replaceChildren(...(problem.portable ? [
    'Close the launcher.',
    'Move the launcher and its Colosseum-Launcher-Portable folder together to a short folder, such as C:\\Games.',
    'Open the launcher from there. Your saves, settings and downloads come with it.'
  ] : ['Open Settings and choose a shorter folder for Setup files, such as C:\\Games.']).map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  $('path-why').textContent = `Windows' compiler can't open files whose paths are 260 characters or more, and the build ` +
    `reaches ${problem.deepest} characters deeper than this folder.`;
  closeModal();
  $('path-too-long').showModal();
  return true;
}
$('path-show-folder').addEventListener('click', () => window.colo.showPathFolder().catch(showError));

function showMacHelp() {
  closeModal();
  $('mac-tools-help').showModal();
}

for (const id of ['mac-setup-help', 'mac-tools-settings']) $(id).addEventListener('click', showMacHelp);
$('check-mac-tools').addEventListener('click', async () => {
  $('check-mac-tools').disabled = true;
  $('mac-check-result').textContent = 'Checking tools…';
  try { refresh(await window.colo.checkTools()); }
  catch (error) { showError(error); }
  finally { $('check-mac-tools').disabled = false; }
});

// Electron prefixes errors thrown in the main process with the IPC channel:
// "Error invoking remote method 'import-dolphin-save': Error: <message>".
function errorText(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
}
function showError(error) { closeModal(); setMessage(errorText(error), true); }

// Actions that build the game or need its build tools. Play only builds when
// the game isn't set up, needs HD visuals, or updates automatically.
function needsBuild(method) {
  if (method === 'launchGame') return !current.binaryReady || !current.hdVisualsReady ||
    Boolean(current.config.settings.autoUpdate && current.game.needsUpdate);
  return ['installPort', 'installTextures', 'build', 'setupGame', 'prepareGame', 'updateAndPlay', 'updatePort'].includes(method);
}

async function action(method) {
  setMessage('');
  // In a folder too deep for Windows, explain instead of starting a build that would fail.
  if (current?.pathProblem && needsBuild(method)) { showPathProblem(); return; }
  try {
    if (['installPort', 'installTextures', 'build', 'setupGame', 'prepareGame', 'launchGame', 'updateAndPlay', 'updatePort', 'play', 'playPrevious'].includes(method))
      setConsoleFollowing(true);
    const result = await window.colo[method]();
    if (result && result.config) refresh(result);
    await sync();
    if (['installPort', 'chooseRepo'].includes(method) && current.repoReady && current.tools.ready && wizardStep === 1) wizardStep = 2;
    if (method === 'chooseRom' && current.romReady && wizardStep === 2) wizardStep = 3;
    refresh(current);
  } catch (error) {
    showError(error);
    await sync();
    if (errorText(error) === current.pathProblem?.message) showPathProblem();
  }
}

function runWizardAction(method) {
  setupPending = true;
  refresh(current);
  action(method).finally(() => { setupPending = false; if (current) refresh(current); });
}

function renderTheme() { $('shell').classList.toggle('dark', $('darkMode').checked); }
$('darkMode').addEventListener('input', renderTheme);

function renderRanges() {
  $('brightness-value').textContent = `${$('brightness').value}%`;
  $('sharpen-value').textContent = Number($('sharpen').value) ? `${$('sharpen').value}%` : 'Off';
}

// Same as the launcher and Primary, and a monitor chosen in the game's own settings menu (monitor2, ...).
function renderDisplays(chosen) {
  const option = (value, label) => { const item = document.createElement('option'); item.value = value; item.textContent = label; return item; };
  const match = /^monitor(\d+)$/.exec(chosen || '');
  $('display').replaceChildren(option('launcher', 'Same as the launcher'), option('primary', 'Primary monitor'),
    ...match ? [option(chosen, `Monitor ${match[1]} (chosen in the game)`)] : []);
}

// Exclusive fullscreen sizes up to this screen's own (the game picks the closest mode the display has).
function renderExclusiveResolutions(chosen) {
  // screen sizes ignore page zoom, but devicePixelRatio includes it.
  const display = globalThis.screen || { width: 1920, height: 1080 }, scale = (globalThis.devicePixelRatio || 1) / window.colo.zoomFactor();
  const nativeWidth = Math.round(display.width * scale), nativeHeight = Math.round(display.height * scale);
  const sizes = ['1280x720', '1600x900', '1920x1080', '2560x1080', '2560x1440', '3440x1440', '3840x2160']
    .filter(size => { const [w, h] = size.split('x').map(Number); return w <= nativeWidth && h <= nativeHeight; });
  if (chosen && chosen !== 'desktop' && !sizes.includes(chosen)) sizes.push(chosen);
  const option = (value, label) => { const item = document.createElement('option'); item.value = value; item.textContent = label; return item; };
  $('exclusiveResolution').replaceChildren(option('desktop', `Desktop (${nativeWidth}×${nativeHeight})`),
    ...sizes.map(size => option(size, size.replace('x', '×'))));
}

// Choices that only matter with another one on are dimmed until then.
function renderDependents(busy = false) {
  $('fullscreenMode').disabled = busy || !$('fullscreen').checked;
  $('exclusiveResolution').disabled = busy || !$('fullscreen').checked || $('fullscreenMode').value !== 'exclusive';
  // the game keeps its battle panels in the middle in 4:3
  $('hudEdges').disabled = busy || $('widescreen').value === '4:3';
  // FSR 1's quality sets the internal resolution, in place of Resolution
  const fsr = ['fsr', 'nis'].includes($('presentFilter').value);
  $('fsrMode').disabled = busy || !fsr;
  $('fsr-hint').hidden = !fsr;
  $('resolution').disabled = busy || fsr;
  $('textureLoading').disabled = busy || !$('textures').checked;
  $('texture-loading-hint').textContent = {
    stage: 'Before each area: an area\'s HD textures load with it, so they don\'t pop in while you play.',
    all: 'Whole pack: every HD texture loads during the first few loading screens and stays, so after that none load at all. Needs a graphics card with 6 GB of memory or more.',
    play: 'While playing: each HD texture loads when it first appears, using the least memory. The original shows until it is ready.'
  }[$('textureLoading').value];
}

function settingsValue() {
  const value = { keyBindings, padBindings, stickDeadzone: Number($('stickDeadzone').value),
    triggerClick: Number($('triggerClick').value), rumbleStrength: Number($('rumbleStrength').value) };
  for (const key of SELECTS) value[key] = $(key).value;
  for (const key of SWITCHES) value[key] = $(key).checked;
  return value;
}

async function saveSettings() {
  if (changing) return;
  try { refresh(await window.colo.saveSettings(settingsValue())); }
  // A refused change (a task started) must not stay shown as if it were saved.
  catch (error) { if (current) refresh(current); showError(error); }
}

function appendLog(entry) {
  if (entry.sequence <= activityLog.resetSequence()) return;
  activityLog.merge(entry);
  if (entry.stream === 'launcher' && /^(✕|Uncaught launcher error:)/.test(entry.text)) {
    consoleFailed = true;
    renderConsoleState(current?.active);
    setConsoleOpen(true);
  }
  scheduleLogRender();
}

function scheduleLogRender() {
  if (logRenderPending) return;
  logRenderPending = true;
  requestAnimationFrame(() => {
    logRenderPending = false;
    const log = $('log');
    const entries = activityLog.snapshot();
    log.replaceChildren(...entries.map(entry => {
      const line = document.createElement('span');
      line.className = `log-line log-${entry.stream}${entry.stream === 'launcher' && entry.text.startsWith('✕') ? ' log-error' : ''}`;
      line.textContent = window.coloActivityLog.formatEntry(entry) + '\n';
      return line;
    }));
    $('console-empty').hidden = Boolean(entries.length);
    $('console-entry-count').textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
    if (consoleFollowing) log.scrollTop = log.scrollHeight;
  });
}

function resetLog(sequence) {
  if (sequence <= activityLog.resetSequence()) return;
  activityLog.reset(sequence);
  $('log').textContent = '';
  $('copy-log-result').textContent = '';
  $('copy-activity-log').textContent = 'Copy log';
  consoleFailed = false;
  setConsoleFollowing(true);
  renderConsoleState(current?.active);
  scheduleLogRender();
}

for (const [id, method] of Object.entries({
  'choose-rom': 'chooseRom', 'choose-rom-settings': 'chooseRom',
  'choose-repo-settings': 'chooseRepo', 'choose-location': 'chooseLocation',
  'play-installed': 'play', 'play-previous': 'playPrevious', 'build': 'build',
  'clean-preview': 'cleanPreview', clean: 'clean', 'remove-build-tools': 'removeBuildTools', 'backup-saves': 'backupSaves',
  'open-backups': 'openBackups', stop: 'stop'
})) $(id).addEventListener('click', () => action(method));
// Update game (Settings) builds the new game and stays in the launcher.
async function updateOnly() {
  await action('updatePort');
  if (current.binaryReady && !current.game.needsUpdate && !current.active)
    setMessage(`Updated to game ${current.game.installedVersion || current.game.availableVersion}. Play whenever you're ready.`);
}
$('update-port').addEventListener('click', updateOnly);
// The Play menu's Update only / Prepare only gets everything Play would first, so Play later starts straight away.
async function prepareOnly() {
  const update = current.binaryReady;
  setupPending = true;
  refresh(current);
  try { await action('prepareGame'); } finally { setupPending = false; if (current) refresh(current); }
  if (current.binaryReady && !current.game.needsUpdate && !current.active)
    setMessage(update ? `Updated to game ${current.game.installedVersion || current.game.availableVersion}. Play whenever you're ready.`
      : 'The game is ready. Play whenever you\'re ready.');
}
// The menu sits in the top layer, above the panel that would clip it, and closes on a click outside or Escape.
$('play-menu').addEventListener('beforetoggle', event => {
  if (event.newState !== 'open') return;
  const anchor = $('play').getBoundingClientRect();
  $('play-menu').style.left = `${anchor.left}px`;
  $('play-menu').style.bottom = `${window.innerHeight - anchor.top + 10}px`;
});
$('play-menu').addEventListener('toggle', event => {
  playMenuOpen = event.newState === 'open';
  $('play-more').setAttribute('aria-expanded', String(playMenuOpen));
  if (playMenuOpen) playMenuItems()[0]?.focus();
});
const playMenuItems = () => [...$('play-menu').querySelectorAll('.play-menu-item')].filter(item => !item.hidden);
$('play-menu').addEventListener('keydown', event => {
  const items = playMenuItems(), step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  items[(items.indexOf(document.activeElement) + step + items.length) % items.length]?.focus();
});
function closePlayMenu() {
  if (!playMenuOpen) return false;
  $('play-menu').hidePopover();
  $('play-more').focus();
  return true;
}
for (const [id, run] of Object.entries({
  'menu-default': () => $('play').click(),
  'menu-update-play': () => runWizardAction('updateAndPlay'),
  'menu-update-only': prepareOnly,
  'menu-play-now': () => action('play')
})) $(id).addEventListener('click', () => { $('play-menu').hidePopover(); run(); });

// --- Changelog: changelog.json in the launcher repository (src/changelog.js). Each release lists its
// launcher changes and the game it pins. After an update it opens once on the newest release since the last.
// Beta builds also get Beta's hand-written notes, shown again whenever they change.
// Beta and the releases are listed down the left; the chosen one shows its launcher and game changes side
// by side, each as a bold headline over its details (src/changelog-text.js), with its fixes as a checklist.
function changelogDate(date) {
  return date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}
function changelogNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
// Long details are cut to a few lines; those changes open in full on a click, or A on a controller.
function changelogToggle(change) {
  if (!change.classList.contains('can-open')) return;
  const open = !change.classList.contains('open');
  change.classList.toggle('open', open);
  change.setAttribute('aria-expanded', String(open));
}
function changelogClamps() {
  for (const change of $('changelog-columns').querySelectorAll('.changelog-change')) {
    const open = change.classList.contains('open');
    const more = open || [...change.querySelectorAll('.changelog-clamp')].some(node => node.scrollHeight > node.clientHeight + 1);
    change.classList.toggle('can-open', more);
    if (more) { change.tabIndex = 0; change.setAttribute('role', 'button'); change.setAttribute('aria-expanded', String(open)); }
    else for (const name of ['tabindex', 'role', 'aria-expanded']) change.removeAttribute(name);
  }
}
window.addEventListener('resize', () => { if (page === 'changelog') changelogClamps(); });
function changelogChange(text, withTag) {
  const { tag, headline, runOn, body } = window.coloChangelogText.splitChange(text);
  const change = changelogNode('div', 'changelog-change');
  const head = changelogNode('p', 'changelog-headline');
  if (withTag && tag) head.append(changelogNode('span', `changelog-tag${tag === 'Multiplayer' ? ' multiplayer' : ''}`, tag));
  head.append(changelogNode('strong', null, headline));
  if (runOn) { head.append(runOn); head.classList.add('changelog-clamp'); }
  change.append(head);
  if (body) change.append(changelogNode('p', 'changelog-details changelog-clamp', body));
  change.addEventListener('click', () => changelogToggle(change));
  change.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); changelogToggle(change); }
  });
  return change;
}
function changelogColumn(heading, lines) {
  const column = changelogNode('section', 'changelog-column');
  const title = changelogNode('h3', null, heading);
  title.append(changelogNode('span', 'changelog-count', String(lines.length)));
  const fixed = line => window.coloChangelogText.splitChange(line).fix;
  column.append(title, ...lines.filter(line => !fixed(line)).map(line => changelogChange(line, true)));
  const fixes = lines.filter(fixed);
  if (fixes.length) {
    const list = changelogNode('ul', 'changelog-fixes');
    list.append(...fixes.map(line => { const item = changelogNode('li'); item.append(changelogChange(line, false)); return item; }));
    column.append(changelogNode('h4', null, `Fixes · ${fixes.length}`), list);
  }
  return column;
}
// Beta first when this build has its notes, then every release, newest first.
function changelogEntries(data) {
  const entries = data.releases.map(release => ({ key: release.version, release,
    hotfixOf: data.releases.find(other => other.version === release.hotfixFor) || null,
    badge: data.unseen.includes(release.version) ? ['New', 'badge good'] : release.version === data.current ? ['Installed', 'badge'] : null }));
  if (data.beta) entries.unshift({ key: 'beta', beta: data.beta, badge: data.beta.unseen ? ['New', 'badge good'] : ['Not released yet', 'badge warn'] });
  return entries;
}
let changelogButtons = [];
function changelogStatus(text) {
  $('changelog-status').textContent = text;
  $('changelog-status').hidden = false;
  $('changelog-head').hidden = true;
  $('changelog-columns').replaceChildren();
}
function changelogShow(entry) {
  for (const button of changelogButtons) {
    const active = button.dataset.key === entry.key;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
  }
  const release = entry.release;
  $('changelog-status').hidden = true;
  $('changelog-head').hidden = false;
  $('changelog-version').textContent = entry.beta ? 'Beta' : `v${release.version}`;
  $('changelog-badge').hidden = !entry.badge;
  if (entry.badge) [$('changelog-badge').textContent, $('changelog-badge').className] = entry.badge;
  $('changelog-meta').textContent = entry.beta ? 'In this Beta build, not in a release yet. Beta uses the newest game from its main branch.'
    : [changelogDate(release.date), release.game?.version && `Game ${release.game.version}`, release.title].filter(Boolean).join(' · ');
  const launcher = entry.beta ? entry.beta.launcher : release.launcher, game = entry.beta ? entry.beta.game : release.game?.changes || [];
  const columns = (launcherLines, gameLines) => [['Launcher', launcherLines], ['Game', gameLines]]
    .filter(([, lines]) => lines.length).map(([heading, lines]) => changelogColumn(heading, lines));
  // A hotfix: the fix in its own box, then the release it fixes in full, so its notes stay in view.
  const base = entry.hotfixOf;
  $('changelog-columns').classList.toggle('changelog-full', Boolean(base));
  if (base) {
    const fix = changelogNode('div', 'changelog-hotfix');
    fix.append(changelogNode('p', 'changelog-hotfix-label', release.title || 'Hotfix'),
      ...[...game, ...launcher].map(line => changelogChange(line, false)));
    const heading = changelogNode('div', 'changelog-base-head');
    heading.append(changelogNode('h3', null, `Everything new in v${base.version}`),
      changelogNode('p', null, [changelogDate(base.date), base.game?.version && `Game ${base.game.version}`].filter(Boolean).join(' · ')));
    $('changelog-columns').replaceChildren(fix, heading, ...columns(base.launcher, base.game?.changes || []));
  } else {
    $('changelog-columns').replaceChildren(...columns(launcher, game));
  }
  $('changelog-detail').scrollTop = 0;
  requestAnimationFrame(changelogClamps);
}
function renderChangelog(data, onlyUnseen) {
  const entries = changelogEntries(data);
  const unseen = entries.filter(entry => entry.badge?.[0] === 'New'), releases = unseen.filter(entry => entry.release);
  $('changelog-title').textContent = !onlyUnseen ? "What's new" : releases.length ? `Updated to v${data.current}` : "What's new in Beta";
  $('changelog-subtitle').textContent = !onlyUnseen ? 'Launcher and game updates'
    : releases.length ? `What's new in the launcher and game since you last opened it.` : "Changes in this Beta that aren't in a release yet.";
  changelogButtons = entries.map(entry => {
    const button = changelogNode('button', `changelog-version${entry.beta ? ' beta' : ''}`);
    button.dataset.key = entry.key;
    const name = changelogNode('span', 'changelog-version-name');
    name.append(changelogNode('strong', null, entry.beta ? 'Beta' : `v${entry.release.version}`));
    if (entry.release && entry.badge) {
      const dot = changelogNode('i', `changelog-dot${entry.badge[0] === 'New' ? ' new' : ''}`);
      dot.title = entry.badge[0];
      name.append(dot);
    }
    button.append(name, changelogNode('small', null, entry.beta ? (entry.beta.unseen ? 'New notes' : 'Not released yet') : changelogDate(entry.release.date)));
    button.addEventListener('click', () => changelogShow(entry));
    return button;
  });
  $('changelog-nav').replaceChildren(...changelogButtons);
  if (!entries.length) return changelogStatus('No changes are listed yet.');
  // After an update, the newest release since the last (or Beta's new notes); otherwise the top of the list.
  changelogShow(onlyUnseen ? releases[0] || unseen[0] || entries[0] : entries[0]);
}
// The What's new tab shows every release; after an update it opens on the newest one.
let changelogUnseen = false;
async function showChangelog() {
  if (changelogUnseen) { changelogUnseen = false; return; }
  $('changelog-title').textContent = "What's new";
  $('changelog-subtitle').textContent = 'Launcher and game updates';
  $('changelog-nav').replaceChildren();
  changelogStatus('Loading…');
  try { renderChangelog(await window.colo.changelog(), false); }
  catch (_) { changelogStatus("The changelog couldn't be loaded. Try again later."); }
}
onPage('changelog', { show() { $('changelog-new').hidden = true; showChangelog(); } });
// Opens once per update. Away from Play, over another window or during a running task it waits for the next start.
async function showWhatsNew() {
  try {
    const data = await window.colo.changelog();
    if (data.unseen.length || data.beta?.unseen) {
      // Not opened now: the What's new button keeps a dot until it is.
      $('changelog-new').hidden = page === 'changelog';
      if (current?.active || page !== 'play' || [...document.querySelectorAll('.launcher-modal')].some(dialog => dialog.open)) return;
      renderChangelog(data, true);
      changelogUnseen = true;
      showPage('changelog');
    }
    await window.colo.markChangelogSeen();
  } catch (_) { /* the changelog button still works */ }
}
$('changelog-page').addEventListener('click', () => window.colo.openChangelogPage().catch(error => setMessage(errorText(error))));
$('play').addEventListener('click', () => {
  if (wizardStep === 0) runWizardAction('launchGame');
  else if (wizardStep === 1) {
    if (current.platform.id === 'macos' && !current.tools.appleReady) { showMacHelp(); return; }
    if (current.repoReady && current.tools.ready) { wizardStep = 2; refresh(current); }
    else runWizardAction('installPort');
  } else if (wizardStep === 2) {
    if (current.romReady) { wizardStep = 3; refresh(current); }
    else runWizardAction('chooseRom');
  } else runWizardAction('setupGame');
});
for (const button of document.querySelectorAll('[data-setup-back]')) button.addEventListener('click', () => {
  if (wizardStep > 1) { wizardStep -= 1; refresh(current); }
});
$('restore-saves').addEventListener('click', async () => {
  setMessage('');
  try { await window.colo.restoreSaves($('backup-list').value); await sync(); }
  catch (error) { showError(error); await sync(); }
});
$('open-custom-textures').addEventListener('click', () => window.colo.openCustomTextures().catch(showError));
for (const key of [...SELECTS, ...SWITCHES]) $(key).addEventListener('change', saveSettings);
for (const key of ['sharpen', 'brightness']) $(key).addEventListener('input', renderRanges);
for (const key of ['fullscreen', 'fullscreenMode', 'widescreen', 'presentFilter', 'textures', 'textureLoading'])
  $(key).addEventListener('input', () => renderDependents());
window.colo.onLog(appendLog);
window.colo.onLogReset(resetLog);
window.colo.onActivity(value => {
  const changed = Boolean(value) !== Boolean(current?.active);
  // Update & play builds and then starts the game in one task: reread the versions once the new game boots.
  const gameStarted = value?.label === GAME_LABEL && current?.active?.label !== value.label;
  if (current) current.active = value;
  renderActivity(value);
  // Lock the settings now: the next state (sync) can take a while to arrive.
  if (changed && current) refresh(current);
  if (changed || gameStarted) sync().catch(showError);
});
let checkingUpdates = false;
function renderAppUpdate(value) {
  $('app-update').textContent = value.message;
  $('install-app-update').hidden = value.state !== 'ready';
  $('check-updates').disabled = checkingUpdates || value.state === 'checking' || value.state === 'downloading';
}
// Check for a launcher update now, then reread the game's versions.
async function checkForUpdates() {
  if (checkingUpdates) return;
  checkingUpdates = true;
  $('check-updates').disabled = true;
  $('check-updates').classList.add('checking');
  try {
    await window.colo.checkAppUpdate();
    await sync();
  } catch (error) { showError(error); }
  finally {
    checkingUpdates = false;
    $('check-updates').classList.remove('checking');
    $('check-updates').disabled = false;
  }
}
window.colo.onAppUpdate(renderAppUpdate);
$('install-app-update').addEventListener('click', () => window.colo.installAppUpdate().catch(showError));
$('check-updates').addEventListener('click', checkForUpdates);
// The middle window button maximizes (the taskbar stays in view) or restores the window, and leaves full screen,
// which F11 switches.
const WINDOW_BUTTON = { normal: 'Maximize', maximized: 'Restore down', fullscreen: 'Exit full screen' };
function renderWindowState(value) {
  const state = value?.fullscreen ? 'fullscreen' : value?.maximized ? 'maximized' : 'normal';
  $('window-maximize').setAttribute('data-state', state);
  $('window-maximize').setAttribute('aria-label', state === 'normal' ? 'Maximize window' : WINDOW_BUTTON[state]);
  $('window-maximize').title = state === 'fullscreen' ? WINDOW_BUTTON[state] : `${WINDOW_BUTTON[state]} (F11: full screen)`;
}
$('window-minimize').addEventListener('click', () => window.colo.minimizeWindow());
$('window-maximize').addEventListener('click', () => window.colo.toggleMaximize().then(renderWindowState).catch(showError));
$('window-close').addEventListener('click', () => window.colo.closeWindow());
window.colo.onWindowState(renderWindowState);

// --- Controller navigation (src/gamepad-nav.js).
const openDialog = () => [...document.querySelectorAll('.launcher-modal[open]')].pop();
// LB / RB step through the Settings tabs on Settings, and through the launcher's tabs elsewhere.
function stepPage(step) {
  if (openDialog()) return;
  if (page === 'settings') {
    const target = settingsTabs[settingsTabs.indexOf(settingsTab) + step];
    if (!target) return;
    showSettingsTab(target);
    $(`tab-${target}`).focus();
    return;
  }
  const shown = pageOrder.filter(name => !$(pages[name].nav).hidden);
  const target = shown[shown.indexOf(page) + step];
  if (!target) return;
  showPage(target);
  $(pages[target].nav).focus();
}
function gamepadBack() {
  const dialog = openDialog();
  if (closePlayMenu()) return;
  if (dialog) dialog.close();
  else if (consoleOpen) setConsoleOpen(false);
  else if (page !== 'play') { showPage('play'); $('nav-play').focus(); }
  else [...document.querySelectorAll('[data-setup-back]')].find(button => !button.disabled && button.offsetParent)?.click();
}
// Escape goes back to Play, as it closed these pages when they were dialogs. Controls' key capture
// takes Escape first, and an open dialog closes itself.
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented || capture || openDialog() || page === 'play') return;
  showPage('play');
});
// F11 (and Ctrl+Cmd+F on a Mac) switches the launcher's full screen, unless Controls is waiting for a key.
window.addEventListener('keydown', event => {
  const macFullScreen = event.metaKey && event.ctrlKey && event.key?.toLowerCase() === 'f';
  if ((event.key !== 'F11' && !macFullScreen) || event.defaultPrevented || capture || event.repeat) return;
  event.preventDefault();
  window.colo.toggleFullScreen().then(renderWindowState).catch(showError);
});
window.coloGamepadNav.start({
  document, window,
  regions: '.switch, .field',
  defaultFocus: () => [page === 'settings' ? $(`tab-${settingsTab}`) : page === 'play' ? $('play') : $(pages[page].nav), $('play'), $('settings-cog')],
  // The game reads the same controller, and Controls waits for a button to bind.
  paused: () => current?.active?.label === GAME_LABEL || Boolean(capture),
  actions: {
    back: gamepadBack,
    menu: () => openDialog() ? closeModal() : showPage(page === 'settings' ? 'play' : 'settings'),
    view: () => consoleOpen ? setConsoleOpen(false) : showActivityLog(),
    previous: () => stepPage(-1),
    next: () => stepPage(1)
  }
});
window.colo.windowState().then(renderWindowState).catch(showError);
setInterval(() => { if (current?.active) renderActivity(current.active); }, 1000);
sync().then(() => { for (const line of current.logs) appendLog(line); if (!showPathProblem()) return showWhatsNew(); }).catch(showError);
