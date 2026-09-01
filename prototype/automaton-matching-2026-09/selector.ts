// Shared selector representation for the #80 automaton-matching investigation.
//
// Scope (deliberately a SUBSET of the full YAJS grammar - see the issue's own
// "representative subset" framing): definite child chains, wildcard (*),
// descendant (..), and single-key filters ([key]step, matching this repo's
// AbstractFilteredOperator "OR of listed keys present as an ancestor"
// semantics for the common single-key case). NOT supported: boolean filter
// expressions (`[key1 && key2]`, `[key1 || key2]`), project/drop actions
// (`<...>`/`{...}`), and the bare-"$"-matches-a-top-level-array's-own-
// elements edge case (YAJSPath.match()'s `rootThroughArray` special case).
// These are called out explicitly in the writeup as remaining scope.

import { YAJSPath } from '../../src/main/lib/path/YAJSPath';

export interface Step {
    // true iff this step is preceded by '..' (a Descendant operator sits
    // directly before it in the real compiled operator array).
    descendant: boolean;
    kind: 'CHILD' | 'WILDCARD';
    key?: string;          // only for CHILD
    filterKey?: string;    // optional; single-key filter only (see header)
}

export function toSelectorString(steps: Step[]): string {
    return '$' + steps.map((s) => {
        const dots = s.descendant ? '..' : '.';
        const filter = s.filterKey ? `[${s.filterKey}]` : '';
        const field = s.kind === 'WILDCARD' ? '*' : s.key;
        return `${dots}${filter}${field}`;
    }).join('');
}

// Builds the REAL YAJSPath (the reference implementation under
// investigation) from the same Step[] the automaton compiles from, so both
// matchers are built from one shared source of truth instead of two
// independently-hand-maintained representations.
export function buildRealPath(steps: Step[]): YAJSPath {
    const builder = new YAJSPath.Builder();
    for (const s of steps) {
        if (s.descendant) {
            builder.addDescendant();
        }
        if (s.kind === 'WILDCARD') {
            builder.addWildcard(s.filterKey ? s.filterKey : undefined, s.filterKey ? [s.filterKey] : undefined);
        } else {
            builder.addChild(s.key, s.filterKey ? s.filterKey : undefined, s.filterKey ? [s.filterKey] : undefined);
        }
    }
    return builder.build();
}

// Tiny hand parser for the subset described above - intentionally NOT a
// reimplementation of the ANTLR grammar (that would defeat the purpose of
// reusing the real parser/grammar risk-free); just enough to read the
// existing test corpus's selector strings that fall within our subset, and
// to round-trip toSelectorString() output for logging.
export function parseSelector(path: string): Step[] {
    if (path.charAt(0) !== '$') {
        throw new Error(`unsupported selector (must start with $): ${path}`);
    }
    let i = 1;
    const steps: Step[] = [];
    while (i < path.length) {
        let descendant = false;
        if (path.startsWith('..', i)) {
            descendant = true;
            i += 2;
        } else if (path.startsWith('.', i)) {
            i += 1;
        } else {
            throw new Error(`unsupported selector syntax at ${i}: ${path}`);
        }
        let filterKey: string | undefined;
        if (path.charAt(i) === '[') {
            const end = path.indexOf(']', i);
            if (end < 0) {
                throw new Error(`unterminated filter in selector: ${path}`);
            }
            const inner = path.slice(i + 1, end);
            // Only a single bare (lowercase/digit/underscore) key is
            // supported (see header) - reject anything with boolean
            // operators, negation, multiple space/comma-separated keys, or
            // parens. Restricted to ScriptFilterHelper's own
            // isBooleanExpression "safe" charset (`^[_a-z0-9\s]+$`) so a
            // single key never gets misread as a (broken, unresolvable)
            // boolean expression by the real matcher we're differential
            // testing against.
            if (!/^[a-z_][a-z0-9_]*$/.test(inner)) {
                throw new Error(`unsupported filter expression (single lowercase key only): ${path}`);
            }
            filterKey = inner;
            i = end + 1;
        }
        const start = i;
        while (i < path.length && path.charAt(i) !== '.' && path.charAt(i) !== '[') {
            i++;
        }
        const field = path.slice(start, i);
        if (!field) {
            throw new Error(`empty field in selector: ${path}`);
        }
        if (field === '*') {
            steps.push({ descendant, kind: 'WILDCARD', filterKey });
        } else {
            steps.push({ descendant, kind: 'CHILD', key: field, filterKey });
        }
    }
    return steps;
}

// True iff `path` parses under our supported subset (used to filter the
// existing test-suite corpus down to selectors we can differential-test).
export function isSupportedSelector(path: string): boolean {
    try {
        const steps = parseSelector(path);
        return steps.length > 0;
    } catch {
        return false;
    }
}
