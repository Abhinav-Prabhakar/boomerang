#!/usr/bin/env bash
# Seeds the public demo repo (boomerang-demo-target) with a payments service
# containing a REAL but bounded bug: a check-then-act race in RetryQueue.dequeue.
# The worker's job: find it, fix it, prove it with tests — without touching the API.
set -euo pipefail

REPO="${DEMO_REPO:-Abhinav-Prabhakar/boomerang-demo-target}"
DIR="$(mktemp -d)/demo-target"
echo "Seeding $REPO → $DIR"

if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public --description "Payments service — seeded flaky test for Boomerang demo"
fi

mkdir -p "$DIR/src" "$DIR/test"
cd "$DIR"

cat > package.json <<'EOF'
{
  "name": "payments-retry-service",
  "version": "1.2.0",
  "type": "module",
  "description": "Payment retry worker — charges customers exactly once. Or does it?",
  "scripts": { "test": "node --test" }
}
EOF

cat > src/retry.ts <<'EOF'
// src/retry.ts — retry queue for the payments worker
export interface RetryItem {
  id: string;
  chargeId: string;
  attempts: number;
}

// BUG: dequeue() is not atomic. It reads items[0] and checks `processed`,
// THEN yields before removing/claiming the item. Two concurrent workers both
// pass the check on the SAME item → the same charge is retried twice →
// double charge.
export class RetryQueue {
  private items: RetryItem[] = [];
  private processed = new Set<string>();

  enqueue(item: RetryItem) {
    this.items.push(item);
  }

  async dequeue(): Promise<RetryItem | undefined> {
    const item = this.items[0];                  // 1) read head…
    if (!item || this.processed.has(item.id)) return undefined; // 2) …check…
    await Promise.resolve();                     // 3) …yield (race window)…
    this.items = this.items.filter((i) => i !== item); // 4) …remove too late
    this.processed.add(item.id);                 // 5) …claim too late
    return item;
  }

  size() {
    return this.items.length;
  }
}
EOF

cat > src/charger.ts <<'EOF'
// src/charger.ts — the payments charger (API contract — DO NOT TOUCH)
export interface ChargeResult { chargeId: string; ok: boolean }

let charges = 0;
export async function charge(chargeId: string): Promise<ChargeResult> {
  charges++;
  return { chargeId, ok: true };
}
export function chargeCount() { return charges; }
export function resetCharges() { charges = 0; }
EOF

cat > test/retry.test.ts <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RetryQueue } from '../src/retry.ts';
import { charge, chargeCount, resetCharges } from '../src/charger.ts';

// Exactly-once guarantee: N queued retries → exactly N charges, even under
// concurrent workers. Flaky under the race: sometimes 2 charges for 1 item.
test('retry queue processes each item exactly once under concurrency', async () => {
  for (let run = 0; run < 10; run++) {
    resetCharges();
    const q = new RetryQueue();
    q.enqueue({ id: `r${run}`, chargeId: `ch_${run}`, attempts: 0 });

    // two workers racing on the same queue
    const workers = [0, 1].map(async () => {
      const item = await q.dequeue();
      if (item) await charge(item.chargeId);
    });
    await Promise.all(workers);
    assert.equal(chargeCount(), 1, `run ${run}: expected 1 charge, got ${chargeCount()}`);
  }
});

test('dequeue drains the queue in order', async () => {
  const q = new RetryQueue();
  q.enqueue({ id: 'a', chargeId: 'c1', attempts: 0 });
  q.enqueue({ id: 'b', chargeId: 'c2', attempts: 0 });
  assert.equal((await q.dequeue())?.id, 'a');
  assert.equal((await q.dequeue())?.id, 'b');
  assert.equal(await q.dequeue(), undefined);
});
EOF

cat > README.md <<'EOF'
# payments-retry-service

Seeded demo repo for **Boomerang** — a voice pager for async coding agents.

There is a real bug in here: `src/retry.ts` has a check-then-act race in
`dequeue()` that intermittently double-processes retry items (double charges).
`npm test` is flaky — run it a few times.

The Boomerang worker clones this repo, finds the race, fixes it, and — only
after a human says "ship it" on the callback — opens the PR.
EOF

git init -b main >/dev/null
git add -A
git -c user.name="boomerang-seed" -c user.email="seed@localhost" commit -m "payments retry service (seeded: racy dequeue → flaky test)" >/dev/null
git remote add origin "https://github.com/$REPO.git" 2>/dev/null || git remote set-url origin "https://github.com/$REPO.git"
git push -u origin main --force
echo "Seeded $REPO"
