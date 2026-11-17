const ranks = '23456789TJQKA';
const suits = 'cdhs';
const cards = [...suits].flatMap(suit => [...ranks].map(rank => rank + suit));

function scoreFive(hand) {
  const values = hand.map(card => ranks.indexOf(card[0]) + 2).sort((a, b) => b - a);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...counts.keys()];
  const straight = unique.length === 5
    ? (values[0] - values[4] === 4 ? values[0] : values.join() === '14,5,4,3,2' ? 5 : 0)
    : 0;
  const flush = hand.every(card => card[1] === hand[0][1]);
  let category;
  let kickers;
  if (straight && flush) [category, kickers] = [8, [straight]];
  else if (groups[0][1] === 4) [category, kickers] = [7, groups.map(([value]) => value)];
  else if (groups[0][1] === 3 && groups[1][1] === 2) [category, kickers] = [6, groups.map(([value]) => value)];
  else if (flush) [category, kickers] = [5, values];
  else if (straight) [category, kickers] = [4, [straight]];
  else if (groups[0][1] === 3) [category, kickers] = [3, groups.map(([value]) => value)];
  else if (groups[0][1] === 2 && groups[1][1] === 2) [category, kickers] = [2, groups.map(([value]) => value)];
  else if (groups[0][1] === 2) [category, kickers] = [1, groups.map(([value]) => value)];
  else [category, kickers] = [0, values];
  return [category, ...Array.from({ length: 5 }, (_, i) => kickers[i] ?? 0)]
    .reduce((score, value) => score * 15 + value, 0);
}

// Higher scores win. Enumerating five-card subsets also handles two trips,
// three pairs, wheel straights, and a best hand entirely on the board.
function rankHand(hand) {
  if (hand.length < 5 || hand.length > 7 || new Set(hand).size !== hand.length || hand.some(card => !cards.includes(card))) {
    throw new Error('Expected 5–7 distinct valid cards');
  }
  let best = -1;
  for (let a = 0; a < hand.length - 4; a++)
    for (let b = a + 1; b < hand.length - 3; b++)
      for (let c = b + 1; c < hand.length - 2; c++)
        for (let d = c + 1; d < hand.length - 1; d++)
          for (let e = d + 1; e < hand.length; e++)
            best = Math.max(best, scoreFive([hand[a], hand[b], hand[c], hand[d], hand[e]]));
  return best;
}

const streets = ['preflop', 'flop', 'turn', 'river'];
const copy = value => structuredClone(value);
const total = values => values.reduce((sum, value) => sum + value, 0);
const contribution = player => total(Object.values(player.bets));
const participating = player => player.cards.length === 2;
const live = player => participating(player) && !player.folded;
const canAct = player => live(player) && player.stack > 0;
const street = state => streets[[0, 3, 4, 5].indexOf(state.board.length)];
const streetBet = (state, player) => player.bets[street(state)] ?? 0;
const currentBet = state => Math.max(
  street(state) === 'preflop' && state.players.filter(canAct).length > 1 ? state.rules.bigBlind : 0,
  ...state.players.map(player => streetBet(state, player)),
);
const turn = state => state.betting.pending[0] ?? null;
const raiseAllowed = state => state.players.flatMap((player, index) =>
  canAct(player) && (state.betting.reopenAt[index] === null || currentBet(state) >= state.betting.reopenAt[index])
    ? [index] : []);

function order(state, first) {
  return Array.from({ length: state.players.length }, (_, i) => (first + i) % state.players.length);
}

function shuffledDeck(state) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    // Keep the generator's current position in the portable source snapshot.
    state.randomState = (Math.imul(state.randomState, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(state.randomState / 2 ** 32 * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Expected an object');
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(base, key)) throw new Error(`Unknown state field: ${key}`);
    if (value && typeof value === 'object' && !Array.isArray(value)) base[key] = merge(base[key], value);
    else base[key] = copy(value);
  }
  return base;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${label}`);
}

function validate(state) {
  const { rules, players, betting } = state;
  integer(state.randomState, 'random state');
  if (state.randomState > 0xffffffff) throw new Error('Random state must be a 32-bit unsigned integer');
  if (rules.variant !== 'texas-holdem' || rules.betting !== 'no-limit') throw new Error('Only no-limit Texas Hold’em is supported');
  integer(rules.smallBlind, 'small blind', 1);
  integer(rules.bigBlind, 'big blind', rules.smallBlind);
  if (!Array.isArray(players) || players.length < 2 || players.length > 10) throw new Error('Expected 2–10 players');
  if (new Set(players.map(player => player.id)).size !== players.length) throw new Error('Player IDs must be unique');
  integer(state.dealer, 'dealer');
  if (state.dealer >= players.length || typeof state.settled !== 'boolean') throw new Error('Invalid hand state');
  let chips = 0;
  for (const player of players) {
    if (typeof player.id !== 'string' || !player.id || typeof player.folded !== 'boolean') throw new Error('Invalid player');
    integer(player.stack, 'stack');
    chips += player.stack;
    if (!Array.isArray(player.cards) || ![0, 2].includes(player.cards.length)) throw new Error('Expected zero or two hole cards');
    if (!player.bets || typeof player.bets !== 'object' || Array.isArray(player.bets)) throw new Error('Invalid bets');
    for (const [round, amount] of Object.entries(player.bets)) {
      if (!streets.includes(round) || streets.indexOf(round) > streets.indexOf(street(state))) throw new Error('Invalid betting street');
      integer(amount, 'bet');
      chips += state.settled ? 0 : amount;
    }
  }
  integer(chips, 'total chips');
  if (![0, 3, 4, 5].includes(state.board.length)) throw new Error('Invalid board');
  const dealt = players.filter(participating).length;
  if ((dealt !== 0 && dealt < 2) || (!dealt && (state.board.length || state.settled))) throw new Error('Invalid participants');
  if (state.burned.length !== Math.max(0, state.board.length - 2)) throw new Error('Invalid burn cards');
  const allCards = [...state.deck, ...state.board, ...state.burned, ...players.flatMap(player => player.cards)];
  if (allCards.length !== 52 || new Set(allCards).size !== 52 || allCards.some(card => !cards.includes(card))) {
    throw new Error('State must contain all 52 distinct cards');
  }
  integer(betting.lastFullRaise, 'minimum raise', rules.bigBlind);
  if (!Array.isArray(betting.reopenAt) || betting.reopenAt.length !== players.length) throw new Error('Invalid reopening thresholds');
  for (const amount of betting.reopenAt) if (amount !== null) integer(amount, 'reopening threshold');
  if (!Array.isArray(betting.pending) || new Set(betting.pending).size !== betting.pending.length) throw new Error('Invalid pending players');
  for (const index of betting.pending) {
    integer(index, 'pending player');
    if (!players[index] || !canAct(players[index])) throw new Error('Pending player cannot act');
  }
  if ((state.settled || !dealt) && betting.pending.length) throw new Error('No actions allowed outside a hand');
  if (dealt && !state.settled && (!betting.pending.length || players.filter(live).length < 2)) throw new Error('Hand must advance or settle');
  if (state.settled && players.filter(live).length > 1 && state.board.length !== 5) throw new Error('Showdown requires five community cards');
}

function pots(state) {
  const contributions = state.players.map(contribution);
  const levels = [...new Set(contributions.filter(Boolean))].sort((a, b) => a - b);
  let previous = 0;
  return levels.map(level => {
    const contributors = contributions.flatMap((amount, i) => amount >= level ? [i] : []);
    const pot = {
      amount: (level - previous) * contributors.length,
      eligible: contributors.filter(i => live(state.players[i])).map(i => state.players[i].id),
    };
    previous = level;
    return pot;
  });
}

function result(state) {
  if (!state.settled) return null;
  const survivors = state.players.filter(live);
  const scores = new Map(survivors.map(player => [player.id,
    survivors.length === 1 ? 0 : rankHand([...player.cards, ...state.board]),
  ]));
  const payouts = [];
  for (const [potIndex, pot] of pots(state).entries()) {
    const eligible = survivors.length === 1 ? [survivors[0].id] : pot.eligible;
    const best = Math.max(...eligible.map(id => scores.get(id)));
    const winners = order(state, (state.dealer + 1) % state.players.length)
      .map(i => state.players[i].id).filter(id => eligible.includes(id) && scores.get(id) === best);
    if (!winners.length) throw new Error('Pot has no eligible winner');
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount % winners.length;
    winners.forEach((playerId, index) => payouts.push({ playerId, amount: share + (index < remainder ? 1 : 0), potIndex }));
  }
  return { reason: survivors.length === 1 ? 'everyone-folded' : 'showdown', payouts };
}

function returnUncalled(state) {
  const round = street(state);
  const sorted = state.players.map((player, index) => ({ index, amount: streetBet(state, player) }))
    .sort((a, b) => b.amount - a.amount);
  const excess = sorted[0].amount - sorted[1].amount;
  if (excess > 0) {
    const player = state.players[sorted[0].index];
    player.bets[round] -= excess;
    player.stack += excess;
  }
}

function settle(state) {
  returnUncalled(state);
  state.settled = true;
  state.betting.pending = [];
  for (const payout of result(state).payouts) {
    state.players.find(player => player.id === payout.playerId).stack += payout.amount;
  }
}

function advance(state) {
  while (!state.settled) {
    if (state.players.filter(live).length === 1) {
      settle(state);
      return;
    }
    const able = state.players.flatMap((player, i) => canAct(player) ? [i] : []);
    state.betting.pending = state.betting.pending.filter(i => able.includes(i));
    // A lone player with chips can only respond to an outstanding bet.
    if (able.length === 1) {
      state.betting.pending = streetBet(state, state.players[able[0]]) < currentBet(state) ? able : [];
    }
    if (state.betting.pending.length) return;
    returnUncalled(state);
    if (state.board.length === 5) {
      settle(state);
      return;
    }
    state.burned.push(state.deck.shift());
    const count = state.board.length === 0 ? 3 : 1;
    state.board.push(...state.deck.splice(0, count));
    state.betting.lastFullRaise = state.rules.bigBlind;
    state.betting.reopenAt = state.players.map(() => null);
    state.betting.pending = able.length > 1
      ? order(state, (state.dealer + 1) % state.players.length).filter(i => canAct(state.players[i]))
      : [];
  }
}

function pay(state, index, amount) {
  const player = state.players[index];
  player.stack -= amount;
  const round = street(state);
  player.bets[round] = (player.bets[round] ?? 0) + amount;
}

function start(state, suppliedDeck) {
  if (state.players.some(participating) && !state.settled) throw new Error('A hand is already in progress');
  const seats = state.players.flatMap((player, index) => player.stack > 0 ? [index] : []);
  if (seats.length < 2) throw new Error('At least two players need chips');
  if (state.settled || !seats.includes(state.dealer)) {
    state.dealer = order(state, (state.dealer + 1) % state.players.length).find(i => seats.includes(i));
  }
  state.deck = suppliedDeck === undefined ? shuffledDeck(state) : copy(suppliedDeck);
  if (!Array.isArray(state.deck) || state.deck.length !== 52 || new Set(state.deck).size !== 52 || state.deck.some(card => !cards.includes(card))) {
    throw new Error('Expected a complete 52-card deck');
  }
  state.board = [];
  state.burned = [];
  state.settled = false;
  for (const player of state.players) {
    player.cards = [];
    player.bets = {};
    player.folded = false;
  }
  const dealing = order(state, (state.dealer + 1) % state.players.length).filter(i => seats.includes(i));
  for (let pass = 0; pass < 2; pass++) for (const i of dealing) state.players[i].cards.push(state.deck.shift());
  const small = seats.length === 2 ? state.dealer : dealing[0];
  const big = order(state, (small + 1) % state.players.length).find(i => seats.includes(i));
  pay(state, small, Math.min(state.rules.smallBlind, state.players[small].stack));
  pay(state, big, Math.min(state.rules.bigBlind, state.players[big].stack));
  state.betting = {
    lastFullRaise: state.rules.bigBlind,
    pending: order(state, (big + 1) % state.players.length).filter(i => canAct(state.players[i])),
    reopenAt: state.players.map(() => null),
  };
  advance(state);
}

function act(state, command) {
  const index = turn(state);
  if (index === null || state.settled) throw new Error('No player can act');
  const player = state.players[index];
  if (command.playerId !== undefined && command.playerId !== player.id) throw new Error('Wrong player turn');
  const bet = currentBet(state);
  const committed = streetBet(state, player);
  const call = Math.max(0, bet - committed);
  const maximum = committed + player.stack;
  let raised = false;
  if (command.action === 'fold') player.folded = true;
  else if (command.action === 'check') {
    if (call !== 0) throw new Error('Cannot check facing a bet');
  } else if (command.action === 'call') {
    if (call === 0) throw new Error('Nothing to call; check instead');
    pay(state, index, Math.min(call, player.stack));
  } else if (command.action === 'bet' || command.action === 'raise') {
    if ((command.action === 'bet') !== (bet === 0)) throw new Error(bet === 0 ? 'Use bet to open betting' : 'Use raise facing a bet');
    integer(command.to, 'bet target', 1);
    if (!raiseAllowed(state).includes(index)) throw new Error('Betting has not reopened for this player');
    if (!state.players.some((other, i) => i !== index && canAct(other))) throw new Error('No opponent can respond to a raise');
    if (command.to <= bet || command.to > maximum) throw new Error('Raise must exceed the current bet and fit the stack');
    const increment = command.to - bet;
    if (increment < state.betting.lastFullRaise && command.to !== maximum) throw new Error('Raise is below the minimum');
    if (increment >= state.betting.lastFullRaise) state.betting.lastFullRaise = increment;
    pay(state, index, command.to - committed);
    raised = true;
  } else throw new Error(`Unknown action: ${command.action}`);

  state.betting.reopenAt[index] = currentBet(state) + state.betting.lastFullRaise;
  state.betting.pending = raised
    ? order(state, (index + 1) % state.players.length).filter(i => i !== index && canAct(state.players[i]) && streetBet(state, state.players[i]) < currentBet(state))
    : state.betting.pending.filter(i => i !== index);
  advance(state);
}

function derived(state, key) {
  const ready = !state.players.some(participating);
  const player = state.players[turn(state)];
  const bet = currentBet(state);
  const toCall = player ? Math.min(player.stack, Math.max(0, bet - streetBet(state, player))) : 0;
  switch (key) {
    case 'phase': return ready ? 'ready' : state.settled ? 'complete' : street(state);
    case 'turn': return turn(state);
    case 'currentBet': return ready || state.settled ? 0 : bet;
    case 'toCall': return toCall;
    case 'pots': return ready || state.settled ? [] : pots(state);
    case 'pot': return ready || state.settled ? 0 : total(state.players.map(contribution));
    case 'raiseAllowed': return ready || state.settled ? [] : raiseAllowed(state);
    case 'result': return result(state);
    case 'legalActions': {
      if (!player) return [];
      const actions = [{ action: 'fold' }, toCall ? { action: 'call', amount: toCall } : { action: 'check' }];
      const maxTo = streetBet(state, player) + player.stack;
      if (maxTo > bet && raiseAllowed(state).includes(turn(state)) && state.players.some((other, i) => i !== turn(state) && canAct(other))) {
        actions.push({ action: bet === 0 ? 'bet' : 'raise', minTo: Math.min(bet + state.betting.lastFullRaise, maxTo), maxTo });
      }
      return actions;
    }
    default:
      if (Object.hasOwn(state, key)) return copy(state[key]);
      throw new Error(`Unknown field: ${key}`);
  }
}

/** Create a table with optional players, rules, and seed; or restore a snapshot. */
export default function poker(options = {}) {
  let state;
  if (Object.hasOwn(options, 'deck')) state = copy(options);
  else {
    const players = (options.players ?? [{ id: 'player-0', stack: 1000 }, { id: 'player-1', stack: 1000 }])
      .map(player => ({ id: player.id, stack: player.stack ?? 1000, cards: [], folded: false, bets: {} }));
    state = {
      rules: { variant: 'texas-holdem', betting: 'no-limit', smallBlind: 5, bigBlind: 10, ...options.rules },
      dealer: options.dealer ?? 0,
      randomState: options.seed ?? Math.floor(Math.random() * 2 ** 32),
      players,
      board: [], burned: [], deck: [...cards], settled: false,
      betting: { lastFullRaise: options.rules?.bigBlind ?? 10, pending: [], reopenAt: players.map(() => null) },
    };
  }
  validate(state);
  return {
    // No argument returns only source state: safe to JSON.stringify and restore.
    get(key) { return key === undefined ? copy(state) : copy(derived(state, key)); },
    update(change) {
      if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('Expected an update object');
      const next = copy(state);
      if (Object.hasOwn(change, 'action')) {
        if (change.action === 'start') start(next, change.deck);
        else act(next, change);
      } else merge(next, change);
      validate(next);
      state = next;
      return copy(state);
    },
  };
}
