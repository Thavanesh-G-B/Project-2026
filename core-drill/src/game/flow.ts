/**
 * Flow field over open tiles. Walking and flying enemies follow it toward the rig through
 * real tunnels, so they can never cut through solid rock.
 */
import { T } from './balance';
import { tileAt, World } from './terrain';

const HALF_W = 30;
const HALF_H = 24;
export const FLOW_INF = 32767;

const NB: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.41], [-1, 1, 1.41], [1, -1, 1.41], [-1, -1, 1.41],
];

export class FlowField {
  readonly w = HALF_W * 2 + 1;
  readonly h = HALF_H * 2 + 1;
  x0 = 0;
  y0 = 0;
  /** Steps (x10) from each cell to the target; FLOW_INF when unreachable. */
  dist = new Int16Array(this.w * this.h).fill(FLOW_INF);
  private queue = new Int32Array(this.w * this.h * 4);
  valid = false;

  /** Rebuild around (tx, ty) with a breadth-first search over open (AIR) tiles. */
  rebuild(world: World, tx: number, ty: number) {
    this.x0 = tx - HALF_W;
    this.y0 = ty - HALF_H;
    this.dist.fill(FLOW_INF);
    const start = this.cell(tx, ty);
    if (start < 0) { this.valid = false; return; }
    // Dijkstra-lite: two-pass relaxation with a FIFO is enough on a 61x49 window with 1.41 diagonals
    this.dist[start] = 0;
    let head = 0, tail = 0;
    this.queue[tail++] = start;
    while (head < tail) {
      const c = this.queue[head++];
      const cx = (c % this.w) + this.x0;
      const cy = Math.floor(c / this.w) + this.y0;
      const cd = this.dist[c];
      for (const [dx, dy, cost] of NB) {
        const nx = cx + dx, ny = cy + dy;
        const ni = this.cell(nx, ny);
        if (ni < 0) continue;
        if (tileAt(world, nx, ny) !== T.AIR) continue;
        if (dx !== 0 && dy !== 0 && (tileAt(world, cx + dx, cy) !== T.AIR || tileAt(world, cx, cy + dy) !== T.AIR)) continue;
        const nd = cd + Math.round(cost * 10);
        if (nd < this.dist[ni]) {
          this.dist[ni] = nd;
          if (tail < this.queue.length) this.queue[tail++] = ni;
        }
      }
    }
    this.valid = true;
  }

  cell(x: number, y: number): number {
    const lx = x - this.x0, ly = y - this.y0;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return -1;
    return ly * this.w + lx;
  }

  at(x: number, y: number): number {
    const c = this.cell(x, y);
    return c < 0 ? FLOW_INF : this.dist[c];
  }

  /** Best neighbouring open cell to step into from (x, y), or null when unreachable / at the target. */
  next(world: World, x: number, y: number): { x: number; y: number } | null {
    if (!this.valid) return null;
    const here = this.at(x, y);
    if (here >= FLOW_INF) return null;
    let best: { x: number; y: number } | null = null;
    let bd = here;
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy;
      const d = this.at(nx, ny);
      if (d >= bd) continue;
      if (dx !== 0 && dy !== 0 && (tileAt(world, x + dx, y) !== T.AIR || tileAt(world, x, y + dy) !== T.AIR)) continue;
      bd = d;
      best = { x: nx, y: ny };
    }
    return best;
  }
}
