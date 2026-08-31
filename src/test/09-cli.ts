
import { spawn } from 'child_process';
import { describe, expect, it } from 'vitest';

// Exercises the actual CLI binary (dist/main/index.js) as a subprocess,
// since it reads process.stdin/argv and writes directly to stdout/stderr -
// not the kind of pure function the rest of this suite tests in-process.
// Requires `npm run build` to have produced dist/ first, same as every
// other test file that shells out to it (see e.g. issue #5/#9's history).
function runCli(path: string, stdin: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [`${__dirname}/../../dist/main/index.js`, path]);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('error', reject);
        child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
        child.stdin.end(stdin);
    });
}

describe('CLI exit code (issue #16)', () => {

    it('should exit 0 on valid input with no errors', () =>
        runCli('$', '{"a":1}').then(({ stdout, stderr, exitCode }) => {
            expect(exitCode).to.equal(0);
            expect(stdout).to.equal('{"a":1}\n');
            expect(stderr).to.equal('');
        }), 5000);

    it('should exit non-zero when parsing reports an error, not silently ' +
        'succeed', () =>
        runCli('$', '1..').then(({ stderr, exitCode }) => {
            expect(exitCode).to.not.equal(0);
            expect(stderr).to.match(/Unexpected/);
        }), 5000);

    it('should exit non-zero on a structurally invalid document too (not ' +
        'just a malformed token)', () =>
        runCli('$', ']').then(({ stderr, exitCode }) => {
            expect(exitCode).to.not.equal(0);
            expect(stderr.length).to.be.greaterThan(0);
        }), 5000);
});
