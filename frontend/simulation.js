// Educational accounting only. No wallet, proof, signing, or network capabilities.
export class PoolSimulation {
  constructor() {
    this.principal = 300;
    this.idle = 60;
    this.supplied = 240;
    this.treasury = 0;
    this.notes = [1, 2, 3].map(id => ({ id, spent: false }));
    this.lastWithdrawal = null;
  }

  get surplus() { return Math.max(0, this.idle + this.supplied - this.principal); }
  get unspent() { return this.notes.filter(note => !note.spent); }

  deposit() {
    if (this.notes.length >= 1000) throw new Error('This demo is limited to 1,000 notes. Reset to start again.');
    const note = { id: this.notes.length + 1, spent: false };
    this.notes.push(note);
    this.principal += 100;
    this.idle += 100;
    const invested = Math.max(0, this.idle - Math.ceil(this.principal * 0.2));
    this.idle -= invested;
    this.supplied += invested;
    return note;
  }

  withdraw(id, illiquid = false) {
    const note = this.notes.find(item => item.id === id);
    if (!note) throw new Error('Choose an unspent demo note first.');
    if (note.spent) throw new Error('This note’s simulated nullifier has already been used. A second withdrawal is rejected.');
    const shortfall = Math.max(0, 100 - this.idle);
    if (illiquid && shortfall > 0) throw new Error('The liquid reserve is insufficient and lending liquidity is unavailable. The note remains unspent; turn off the liquidity simulation to retry.');
    if (this.idle + this.supplied < this.principal || shortfall > this.supplied) throw new Error('There are insufficient assets to back principal.');
    this.supplied -= shortfall;
    this.idle += shortfall - 100;
    this.principal -= 100;
    note.spent = true;
    this.lastWithdrawal = note.id;
    return note;
  }

  accrueYield() {
    if (this.supplied === 0) throw new Error('No assets are supplied. Add a demo deposit before simulating lending yield.');
    this.supplied += 10;
  }

  harvest(illiquid = false) {
    const amount = this.surplus;
    if (amount === 0) throw new Error('There is no surplus to harvest. Principal cannot fund the treasury.');
    const reserve = Math.ceil(this.principal * 0.2);
    const shortfall = Math.max(0, amount + reserve - this.idle);
    if (illiquid && shortfall > 0) throw new Error('The harvest needs lending liquidity to preserve the principal reserve. No funds have moved.');
    if (shortfall > this.supplied) throw new Error('Insufficient supplied assets.');
    this.supplied -= shortfall;
    this.idle += shortfall - amount;
    this.treasury += amount;
    return amount;
  }
}
