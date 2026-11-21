// Sokoban solver for make.fun sokoban-solver-01
// Full A* search over (player, boxes) states with binary heap.
// Time-boxed per level: larger levels get more time.
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

function nearestGoalDist(b: number, goals: number[], w: number): number {
  let best = Infinity;
  for (const g of goals) best = Math.min(best, Math.abs((b % w) - (g % w)) + Math.abs(Math.floor(b / w) - Math.floor(g / w)));
  return best;
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

function solve(text: string, timeLimitMs: number): string {
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
  const MAX_EXPANSIONS = 5_000_000;
  const startTime = Date.now();

  while (open.size > 0) {
    if (Date.now() - startTime > timeLimitMs) return '';

    const top = open.pop();
    if (!top) break;
    const [f, g, pIdx, bIdx] = top;
    const p = players[pIdx];
    const bs = boxss[bIdx];

    if (bs.every((b) => goalSet.has(b))) return mvss[bIdx];

    expanded++;
    if (expanded > MAX_EXPANSIONS) return '';

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

  return '';
}

function countBoxes(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === '$' || ch === '*') count++;
  }
  return count;
}

const allIds = readdirSync(I).sort();
const totalTimeMs = 50_000; // 50 seconds total
let timeUsed = 0;

for (const id of allIds) {
  const text = readFileSync(join(I, id, 'level.txt'), 'utf8');
  const boxCount = countBoxes(text);
  // Allocate time based on box count: more boxes = more time
  let levelTimeMs = 5_000 + boxCount * 2_000;
  if (levelTimeMs > 20_000) levelTimeMs = 20_000;
  // Don't exceed remaining time
  const remaining = totalTimeMs - timeUsed;
  if (remaining <= 1_000) break;
  if (levelTimeMs > remaining) levelTimeMs = remaining;

  const t0 = Date.now();
  const moves = solve(text, levelTimeMs);
  const elapsed = Date.now() - t0;
  timeUsed += elapsed;

  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
