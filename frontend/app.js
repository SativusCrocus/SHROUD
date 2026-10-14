import { PoolSimulation } from './simulation.js';

let pool = new PoolSimulation();
const byId = id => document.getElementById(id);
const format = value => value.toLocaleString('en-US');
const noteLabel = id => `Note ${String(id).padStart(2, '0')}`;
const coverCount = () => 2 + (crypto.getRandomValues(new Uint8Array(1))[0] & 1);

function setUnits(id, value) {
  const node = byId(id);
  const unit = document.createElement('span');
  unit.textContent = 'units';
  node.replaceChildren(document.createTextNode(format(value)), unit);
}

function render() {
  setUnits('principal-value', pool.principal);
  setUnits('reserve-value', pool.idle);
  setUnits('supplied-value', pool.supplied);
  setUnits('treasury-value', pool.treasury);
  byId('surplus-value').textContent = `${format(pool.surplus)} units`;
  byId('backing-value').textContent = pool.principal > 0
    ? `${((pool.idle + pool.supplied) / pool.principal * 100).toFixed(1).replace('.0', '')}%`
    : 'No outstanding principal';
  byId('note-count').textContent = `${pool.unspent.length} UNSPENT NOTE${pool.unspent.length === 1 ? '' : 'S'}`;
  const previous = byId('note-select').value;
  const options = pool.unspent.map(note => {
    const option = document.createElement('option');
    option.value = String(note.id);
    option.textContent = `${noteLabel(note.id)} · 100 demo units`;
    return option;
  });
  if (!options.length) {
    const empty = document.createElement('option');
    empty.textContent = 'No unspent demo notes';
    empty.value = '';
    options.push(empty);
  }
  byId('note-select').replaceChildren(...options);
  if (pool.unspent.some(note => String(note.id) === previous)) byId('note-select').value = previous;
  byId('note-select').disabled = !pool.unspent.length;
  byId('withdraw-demo').disabled = !pool.unspent.length;
  byId('replay-demo').disabled = pool.lastWithdrawal === null;
  byId('harvest-demo').disabled = pool.surplus === 0;
  byId('yield-demo').disabled = pool.supplied === 0;
}

function announce(title, description, error = false) {
  byId('activity').classList.toggle('error', error);
  byId('activity').querySelector('.activity-icon').textContent = error ? '!' : '✓';
  byId('activity-title').textContent = title;
  byId('activity-description').textContent = description;
}

function perform(action) {
  try { action(); } catch (error) { announce('Simulation: operation rejected', error.message, true); }
  render();
}

byId('deposit-demo').addEventListener('click', () => perform(() => {
  const note = pool.deposit();
  announce('Demo deposit recorded', `${noteLabel(note.id)} adds 100 units of principal. ${coverCount()} illustrative cover records accompany the operation.`);
}));

byId('withdraw-demo').addEventListener('click', () => perform(() => {
  const note = pool.withdraw(Number(byId('note-select').value), byId('illiquid-toggle').checked);
  announce('Demo withdrawal completed', `${noteLabel(note.id)} returned 100 units. Its simulated nullifier is now spent; ${coverCount()} cover records accompany the operation.`);
}));

byId('replay-demo').addEventListener('click', () => perform(() => pool.withdraw(pool.lastWithdrawal)));
byId('yield-demo').addEventListener('click', () => perform(() => {
  pool.accrueYield();
  announce('Hypothetical yield credited', '10 demo units were added to supplied assets. Principal liabilities are unchanged. No actual interest was earned.');
}));
byId('harvest-demo').addEventListener('click', () => perform(() => {
  const amount = pool.harvest(byId('illiquid-toggle').checked);
  announce('Demo surplus harvested', `${format(amount)} units moved to the treasury. Principal and its 20% reserve remain backed. The simulation does not trade or burn tokens.`);
}));
byId('reset-lab').addEventListener('click', () => {
  pool = new PoolSimulation();
  byId('illiquid-toggle').checked = false;
  render();
  announce('Pool reset to sample state', 'Three illustrative deposits, 300 units of principal, and a 60-unit liquid reserve.');
});

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const item of tabs) {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    item.classList.toggle('active', active);
    byId(item.getAttribute('aria-controls')).hidden = !active;
  }
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next]);
    tabs[next].focus();
  });
});

byId('copy-commands').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(byId('install-commands').textContent);
    byId('copy-status').textContent = 'Installation commands copied.';
    byId('copy-commands').textContent = 'Copied ✓';
    setTimeout(() => { byId('copy-commands').textContent = 'Copy ⧉'; }, 2500);
  } catch {
    byId('copy-status').textContent = 'Clipboard unavailable. Select the commands in the terminal to copy them.';
  }
});
render();
