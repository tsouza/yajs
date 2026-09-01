// Random selector + JSON-tree generators for the #80 differential fuzz
// harness. Deliberately biased toward key collisions between the selector
// alphabet and the tree alphabet (a handful of shared key names), since a
// selector/document pair that never shares any key would trivially never
// match anything and wouldn't exercise the interesting wildcard/descendant/
// array-transparency logic this investigation cares about.

import { Step } from './selector';

export interface Rng {
    next(): number; // [0, 1)
}

// Simple deterministic PRNG (mulberry32) so a failing case can be reproduced
// from its seed alone.
export function makeRng(seed: number): Rng {
    let a = seed >>> 0;
    return {
        next(): number {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        },
    };
}

const KEY_ALPHABET = ['a', 'b', 'c', 'x', 'y', 'plugins', 'nodes', 'deep'];

function pick<T>(rng: Rng, arr: T[]): T {
    return arr[Math.floor(rng.next() * arr.length)];
}

export function randomSteps(rng: Rng, maxSteps: number): Step[] {
    const n = 1 + Math.floor(rng.next() * maxSteps);
    const steps: Step[] = [];
    for (let i = 0; i < n; i++) {
        const descendant = i > 0 && rng.next() < 0.5; // first step may also be '..'
        const firstDescendant = i === 0 && rng.next() < 0.4;
        const kind: Step['kind'] = rng.next() < 0.4 ? 'WILDCARD' : 'CHILD';
        const filterKey = rng.next() < 0.2 ? pick(rng, KEY_ALPHABET) : undefined;
        steps.push({
            descendant: i === 0 ? firstDescendant : descendant,
            kind,
            key: kind === 'CHILD' ? pick(rng, KEY_ALPHABET) : undefined,
            filterKey,
        });
    }
    return steps;
}

export type JsonTree = { [key: string]: JsonTree } | JsonTree[] | number;

export function randomTree(rng: Rng, maxDepth: number, maxBranch: number): JsonTree {
    if (maxDepth <= 0 || rng.next() < 0.25) {
        return Math.floor(rng.next() * 1000);
    }
    if (rng.next() < 0.35) {
        const n = 1 + Math.floor(rng.next() * maxBranch);
        const arr: JsonTree[] = [];
        for (let i = 0; i < n; i++) {
            arr.push(randomTree(rng, maxDepth - 1, maxBranch));
        }
        return arr;
    }
    const n = 1 + Math.floor(rng.next() * maxBranch);
    const obj: { [key: string]: JsonTree } = {};
    for (let i = 0; i < n; i++) {
        const key = pick(rng, KEY_ALPHABET) + (rng.next() < 0.3 ? String(Math.floor(rng.next() * 3)) : '');
        obj[key] = randomTree(rng, maxDepth - 1, maxBranch);
    }
    return obj;
}
