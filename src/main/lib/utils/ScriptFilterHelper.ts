import { isEmpty } from 'lodash';
import { createContext, runInContext } from 'vm';

const context = createContext();

// Issue #96's regex filter primitive (e.g. `{/^key\d+$/}`) generalizes the
// existing bare-key-presence primitive from "is this exact key present" to
// "is there a key matching this pattern present" - an existential match
// over the actual, full key set (see README's "regex filter primitive"
// section for the worked example). A regex term's raw parsed text always
// includes its delimiting slashes (see YAJS.g4's REGEX lexer rule, which is
// deliberately defined to win any tie against the plain FilterExpressionTerm
// rule for the same span), so this is a plain content check on that text,
// not a parser call - and, structurally, the grammar guarantees a *bare*
// key's own text can never itself be exactly slash-framed once REGEX
// exists (REGEX always claims that shape), so this check can't misfire
// against a genuine literal key.
export function isRegexFilterKey(text: string): boolean {
    return text.length >= 2 && text.charAt(0) === '/' && text.charAt(text.length - 1) === '/';
}

// User-supplied regex from a CLI/library selector argument is untrusted
// input in the sense that a malicious/careless pattern could be written to
// cost a lot to evaluate (catastrophic backtracking) - but it is NOT
// untrusted in the code-injection sense the rest of this file's
// vm.runInContext compilation already has to guard (see issue #17's
// JSON.stringify escaping in parser/utils.ts): a regex pattern's raw text
// never itself becomes part of the compiled JS source string - only the
// already-escaped, delimiter-included TEXT is embedded there as an
// `args["..."]` lookup key (identically to how a bare key already is), and
// the actual `new RegExp(...)` compilation happens here, in this file's own
// TypeScript, at ScriptFilterHelper construction time - never inside the
// vm.runInContext'd expression itself. So this repo's existing trust model
// for filter expressions (selector strings are trusted enough to compile
// straight to executable JS; see ScriptFilterHelper's constructor) already
// covers regex patterns too for injection purposes. What it does NOT cover
// is evaluation COST, which a presence/absence key check never had to worry
// about (O(1) either way) but a regex match does (patterns like `(a+)+$`
// can be exponential against pathological input) - MAX_REGEX_PATTERN_LENGTH
// is a simple, cheap-to-check sanity bound on that cost, not a security
// sandbox: it caps how large a single pattern can be (long patterns are
// where catastrophic-backtracking constructs actually accumulate), while
// leaving genuine short/moderate patterns - including ones with nested
// quantifiers - to run at native RegExp speed, same as anywhere else in JS.
export const MAX_REGEX_PATTERN_LENGTH = 200;

// Parses a slash-delimited regex filter term (e.g. "/^key\\d+$/", including
// its delimiters) into a compiled RegExp, applying the length cap above and
// surfacing a clean, catchable Error - both for an over-long pattern and for
// one that isn't valid RegExp syntax - instead of a raw, uncaught
// SyntaxError reaching the caller from deep inside this file. Called both
// eagerly at parse time (parser/utils.ts's extractKeys(), purely to
// fail fast - see issues #18/#19's "malformed selectors fail cleanly"
// precedent) and again here at ScriptFilterHelper construction time, whose
// result is the one actually kept and reused for matching.
export function parseRegexFilterKey(text: string): RegExp {
    const pattern = text.slice(1, -1);
    if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
        throw new Error(
            `Invalid regex filter pattern ${text}: pattern exceeds the maximum allowed length ` +
            `of ${MAX_REGEX_PATTERN_LENGTH} characters (${pattern.length}).`);
    }
    try {
        return new RegExp(pattern);
    } catch (e) {
        throw new Error(`Invalid regex filter pattern ${text}: ${(e as Error).message}`);
    }
}

export class ScriptFilterHelper {

    private keys: string[];

    private filter?: (args: object) => boolean;

    // Populated only for `this.keys` entries that are regex-shaped (see
    // isRegexFilterKey above) - the common case (plain bare-key/boolean
    // filters, the overwhelming majority of selectors) leaves this empty,
    // so _createArgs()/_createFilter() below never even ask a caller for
    // its (potentially non-trivial to build - see AbstractFilteredOperator's
    // ancestor-key walk) full key set unless a regex primitive is actually
    // in play.
    private regexByKey: Map<string, RegExp>;

    constructor(keys: string[], expression?: string) {
        if (expression) {
            this.filter = this.isBooleanExpression(expression) ?
                runInContext(`(args) => ${expression}`, context) :
                null;
            this.keys = keys;
            this.regexByKey = new Map();
            (keys || []).forEach((key) => {
                if (isRegexFilterKey(key)) {
                    this.regexByKey.set(key, parseRegexFilterKey(key));
                }
            });
        }
    }

    isFiltered(): boolean {
        return !isEmpty(this.keys);
    }

    // keyVerifier answers "is this exact literal key present" (the existing
    // bare-key primitive's own semantics, unchanged). keySetProvider is a
    // thunk returning the actual, full key set to test a regex primitive's
    // existential match against - only ever invoked (and only once, however
    // many regex terms this filter has) when this.regexByKey is non-empty,
    // so a filter with no regex terms costs exactly what it always did.
    filters(keyVerifier: (key: string) => boolean, keySetProvider?: () => Iterable<string>): boolean {
        const args = this.filter ? this._createArgs(keyVerifier, keySetProvider) : null;
        return this._createFilter(keyVerifier, keySetProvider)(args);
    }

    private _createArgs(keyVerifier: (key: string) => boolean,
                         keySetProvider?: () => Iterable<string>): object {
        // Use a null-prototype object so that a key named "__proto__" becomes a
        // real own property instead of being routed through Object.prototype's
        // inherited __proto__ setter, which would otherwise silently mutate this
        // object's prototype chain instead of storing the key's verification
        // result (and cause a bracket-notation read of args['__proto__'] to
        // always return a truthy prototype object regardless of keyVerifier).
        const args = Object.create(null);
        if (this.keys) {
            let keySet: string[] = null;
            this.keys.forEach((key) => {
                const regex = this.regexByKey.get(key);
                if (regex) {
                    if (keySet === null) {
                        keySet = keySetProvider ? Array.from(keySetProvider()) : [];
                    }
                    args[key] = keySet.some((k) => regex.test(k));
                } else {
                    args[key] = keyVerifier(key);
                }
            });
        }
        return args;
    }

    private _createFilter(keyVerifier: (key: string) => boolean,
                           keySetProvider?: () => Iterable<string>): (args: object) => boolean {
        if (this.filter) {
           return this.filter;
        } else {
            return () => this.keys.
                some((key) => {
                    const regex = this.regexByKey.get(key);
                    if (!regex) {
                        return keyVerifier(key);
                    }
                    const keySet = keySetProvider ? keySetProvider() : [];
                    for (const k of keySet) {
                        if (regex.test(k)) { return true; }
                    }
                    return false;
                });
        }
    }

    private isBooleanExpression(expr: string): boolean {
        return !expr.match(/^[_a-z0-9\s]+$/g);
    }
}
