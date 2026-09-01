// Run the REAL yajs engine on a string input, collect emissions + errors.
'use strict';
const yajs = require('../dist/main/main.js');

// Returns { out: [{path, value}...], errors: [message...] }
function runReal(selector, input, options) {
    return new Promise((resolve) => {
        const out = [];
        const errors = [];
        const stream = yajs(selector, options);
        stream.on('data', (d) => out.push({ path: d.path, value: d.value }));
        stream.on('error', (e) => errors.push(String(e.message)));
        stream.on('end', () => resolve({ out, errors }));
        try {
            stream.write(input);
            stream.end();
        } catch (e) {
            errors.push('THROWN: ' + e.message);
            resolve({ out, errors });
        }
    });
}

module.exports = { runReal };

if (require.main === module) {
    const [, , selector, input, opt] = process.argv;
    runReal(selector, input, opt ? JSON.parse(opt) : undefined).then((r) =>
        console.log(JSON.stringify(r, (k, v) => v === undefined ? '<<undef>>' : v)));
}
