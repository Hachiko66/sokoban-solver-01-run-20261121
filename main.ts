// Sokoban solver for make.fun sokoban-solver-01
// Full A* for small levels, greedy per-box fallback for larger levels.
// Memory-efficient to avoid exit code 134 (SIGABRT).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const DIRS: [number, number, string][] = [
  [0, -1, 'u'],
  [0, 1, 'd'],
  [-1, 0, 'l'],
  [1, 0, 'r'],
];

function parse(text: string) {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall: boolean[] = new Array(w * h).fill(false);
  const goals: number[] = [];
  let boxes: number[] = [];
  let player = 0;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ch = row[x] ?? '#';
      wall[i] = ch === '#';
      if (ch === '.' || ch === '*') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

function manhattan(a: number, b: number, w: number): number {
  return Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
}

function nearestGoalDist(b: number, goals: number[], w: number): number {
  let best = Infinity;
  for (const g of goals) best = Math.min(best, manhattan(b, g, w));
  return best;
}

// Simulate moves to verify legality and completion.
function simulate(text: string, moves: string): { legal: boolean; solved: boolean } {
  const { w, h, wall, goals, boxes, player: initialPlayer } = parse(text);
  const goalSet = new Set(goals);
  let player = initialPlayer;
  let bs = [...boxes];
  for (const ch of moves) {
    const dir = DIRS.find((d) => d[2] === ch.toLowerCase());
    if (!dir) return { legal: false, solved: false };
    const [dx, dy] = dir;
    const d = dy * w + dx;
    const q = player + d;
    if (q < 0 || q >= w * h || wall[q]) return { legal: false, solved: false };
    let nb: number[];
    if (bs.includes(q)) {
      const nq = q + d;
      if (nq < 0 || nq >= w * h || wall[nq] || bs.includes(nq)) return { legal: false, solved: false };
      nb = bs.slice();
      nb[nb.indexOf(q)] = nq;
      nb.sort((a, b) => a - b);
    } else {
      nb = bs;
    }
    player = q;
    bs = nb;
  }
  return { legal: true, solved: bs.every((b) => goalSet.has(b)) };
}

// A* full search for small levels.
class Heap {
  private a: [number, number, number, number][] = [];
  push(f: number, g: number, p: number, b: number) {
    this.a.push([f, g, p, b]);
    let i = this.a.length - 1;
    while (i > 0) {
      const p2 = (i - 1) >> 1;
      if (this.a[i][0] < this.a[p2][0] || (this.a[i][0] === this.a[p2][0] && this.a[i][1] < this.a[p2][1])) {
        [this.a[i], this.a[p2]] = [this.a[p2], this.a[i]];
        i = p2;
      } else break;
    }
  }
  pop(): [number, number, number, number] | null {
    if (this.a.length === 0) return null;
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length > 0) {
      this.a[0] = last;
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= this.a.length) break;
        if (c + 1 < this.a.length && (this.a[c + 1][0] < this.a[c][0] || (this.a[c + 1][0] === this.a[c][0] && this.a[c + 1][1] < this.a[c][1]))) c++;
        if (this.a[c][0] < this.a[i][0] || (this.a[c][0] === this.a[i][0] && this.a[c][1] < this.a[i][1])) {
          [this.a[i], this.a[c]] = [this.a[c], this.a[i]];
          i = c;
        } else break;
      }
    }
    return top;
  }
  get size(): number { return this.a.length; }
}

function solveAstar(text: string, timeLimitMs: number, maxExpansions: number): string | null {
  const { w, h, wall, goals, boxes: initialBoxes, player: initialPlayer } = parse(text);
  const goalSet = new Set(goals);
  if (initialBoxes.every((b) => goalSet.has(b))) return '';

  const est = (bs: number[]): number => bs.reduce((a, b) => a + nearestGoalDist(b, goals, w), 0);

  const players: number[] = [initialPlayer];
  const boxss: number[][] = [initialBoxes];
  const mvss: string[] = [''];

  const open = new Heap();
  const closed = new Set<string>();
  open.push(est(initialBoxes), 0, 0, 0);
  closed.add(`${initialPlayer}|${initialBoxes.join(',')}`);

  let expanded = 0;
  const startTime = Date.now();

  while (open.size > 0) {
    if (Date.now() - startTime > timeLimitMs) return null;

    const top = open.pop();
    if (!top) break;
    const [f, g, pIdx, bIdx] = top;
    const p = players[pIdx];
    const bs = boxss[bIdx];

    if (bs.every((b) => goalSet.has(b))) return mvss[bIdx];

    expanded++;
    if (expanded > maxExpansions) return null;

    for (const [dx, dy, letter] of DIRS) {
      const d = dy * w + dx;
      const q = p + d;
      if (q < 0 || q >= w * h || wall[q]) continue;

      let nb: number[];
      let move = letter;
      const at = bs.indexOf(q);
      if (at >= 0) {
        const nq = q + d;
        if (nq < 0 || nq >= w * h || wall[nq] || bs.includes(nq)) continue;
        nb = bs.slice();
        nb[at] = nq;
        nb.sort((a, b) => a - b);
        move = letter.toUpperCase();
      } else {
        nb = bs;
      }

      if (isDeadlock(nb, wall, goals, w, h)) continue;

      const k = `${q}|${nb.join(',')}`;
      if (closed.has(k)) continue;
      closed.add(k);

      const ng = g + 1;
      players.push(q);
      boxss.push(nb);
      mvss.push(mvss[bIdx] + move);
      open.push(ng + est(nb), ng, players.length - 1, boxss.length - 1);
    }
  }

  return null;
}

function isDeadlock(boxes: number[], wall: boolean[], goals: number[], w: number, h: number): boolean {
  const goalSet = new Set(goals);
  const boxSet = new Set(boxes);
  for (const b of boxes) {
    if (goalSet.has(b)) continue;
    const x = b % w, y = Math.floor(b / w);
    const upWall = y === 0 || wall[b - w];
    const downWall = y === h - 1 || wall[b + w];
    const leftWall = x === 0 || wall[b - 1];
    const rightWall = x === w - 1 || wall[b + 1];
    if ((upWall && leftWall) || (upWall && rightWall) || (downWall && leftWall) || (downWall && rightWall)) return true;
    if ((upWall || downWall) && ((x > 0 && boxSet.has(b - 1)) || (x < w - 1 && boxSet.has(b + 1)))) {
      const adj = (x > 0 && boxSet.has(b - 1)) ? b - 1 : b + 1;
      const ax = adj % w, ay = Math.floor(adj / w);
      const au = ay === 0 || wall[ay * w + ax - w];
      const ad = ay === h - 1 || wall[ay * w + ax + w];
      const al = ax === 0 || wall[ay * w + ax - 1];
      const ar = ax === w - 1 || wall[ay * w + ax + 1];
      if ((au && al) || (au && ar) || (ad && al) || (ad && ar)) return true;
    }
  }
  return false;
}

// Greedy per-box solver: push each box to nearest unclaimed goal.
// Used as fallback when A* can't solve within limits.
function pushBoxToGoal(player: number, box: number, goal: number, allBoxes: number[], wall: boolean[], goals: number[], w: number, h: number): { moves: string; player: number } | null {
  const goalSet = new Set(goals);
  const hEst = (p: number, b: number): number => manhattan(b, goal, w) + manhattan(p, b, w);

  const open: [number, number, number, number][] = [];
  const closed = new Set<string>();
  const parents: Map<string, [number, number, string]> = new Map();

  open.push([hEst(player, box), 0, player, box]);
  closed.add(`${player}|${box}`);

  const MAX_EXP = 30_000;
  let expanded = 0;

  while (open.length > 0) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i][0] < open[bi][0] || (open[i][0] === open[bi][0] && open[i][1] < open[bi][1])) bi = i;
    }
    const [f, g, p, b] = open.splice(bi, 1)[0]!;

    if (b === goal) {
      let moves = '';
      let cur: [number, number] | null = [p, b];
      while (cur) {
        const par = parents.get(`${cur[0]}|${cur[1]}`);
        if (!par) break;
        moves = par[2] + moves;
        cur = [par[0], par[1]];
      }
      return { moves, player: p };
    }

    expanded++;
    if (expanded > MAX_EXP) return null;

    const otherBoxes = new Set(allBoxes.filter((x) => x !== b));

    for (const [dx, dy, letter] of DIRS) {
      const d = dy * w + dx;
      const q = p + d;
      if (q < 0 || q >= w * h || wall[q] || otherBoxes.has(q)) continue;

      let np = q, nb = b, move = letter;
      if (q === b) {
        const nq = q + d;
        if (nq < 0 || nq >= w * h || wall[nq] || otherBoxes.has(nq)) continue;
        nb = nq;
        move = letter.toUpperCase();
      }

      const k = `${np}|${nb}`;
      if (closed.has(k)) continue;

      const nx = nb % w, ny = Math.floor(nb / w);
      if (!goalSet.has(nb)) {
        const uw = ny === 0 || wall[nb - w];
        const dw = ny === h - 1 || wall[nb + w];
        const lw = nx === 0 || wall[nb - 1];
        const rw = nx === w - 1 || wall[nb + 1];
        if ((uw && lw) || (uw && rw) || (dw && lw) || (dw && rw)) continue;
      }

      closed.add(k);
      parents.set(k, [p, b, move]);
      open.push([g + 1 + hEst(np, nb), g + 1, np, nb]);
    }
  }

  return null;
}

function solveGreedy(text: string): string | null {
  const { w, h, wall, goals, boxes: initialBoxes, player: initialPlayer } = parse(text);
  const goalSet = new Set(goals);
  const unclaimedGoals = [...goals];
  let boxes = [...initialBoxes];
  let player = initialPlayer;
  let allMoves = '';

  let progress = true;
  while (progress && unclaimedGoals.length > 0) {
    progress = false;
    boxes.sort((a, b) => manhattan(player, a, w) - manhattan(player, b, w));

    for (const box of boxes) {
      if (goalSet.has(box)) continue;

      let bestGoal = -1, bestDist = Infinity;
      for (const g of unclaimedGoals) {
        const d = manhattan(box, g, w);
        if (d < bestDist) { bestDist = d; bestGoal = g; }
      }
      if (bestGoal < 0) break;

      const result = pushBoxToGoal(player, box, bestGoal, boxes, wall, goals, w, h);
      if (!result) continue;

      allMoves += result.moves;
      player = result.player;
      boxes = boxes.map(b => b === box ? bestGoal : b);
      unclaimedGoals.splice(unclaimedGoals.indexOf(bestGoal), 1);
      progress = true;
      break;
    }
  }

  const check = simulate(text, allMoves);
  if (!check.legal || !check.solved) return null;
  return allMoves;
}

function solve(text: string): string {
  const { w, h, wall, goals, boxes: initialBoxes, player: initialPlayer } = parse(text);
  const goalSet = new Set(goals);
  if (initialBoxes.every((b) => goalSet.has(b))) return '';

  const boxCount = initialBoxes.length;
  // Full A* for small levels only - memory bounded to avoid crash
  if (boxCount <= 6) {
    const result = solveAstar(text, boxCount <= 4 ? 25_000 : 20_000, boxCount <= 4 ? 800_000 : 500_000);
    if (result !== null) return result;
  }

  // Greedy per-box fallback for larger levels
  const greedy = solveGreedy(text);
  if (greedy !== null) return greedy;

  return '';
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
