'use strict';
// Generates two synthetic NDJSON datasets (~40MB each) into a target dir:
//   longstr.ndjson - objects whose values are 120-char ASCII strings
//   numbers.ndjson - objects whose values are number arrays
const fs = require('fs');
const dir = process.argv[2];
{
  const line = JSON.stringify({ field1: 'x'.repeat(120), field2: { nested: 'y'.repeat(120) } }) + '\n';
  const n = Math.ceil(40e6 / line.length);
  fs.writeFileSync(dir + '/longstr.ndjson', line.repeat(n));
}
{
  const line = JSON.stringify({ a: 12345678, b: [3.14159265358979, 2.718281828459045, 1e-7, 123456789012345], c: -0.000123 }) + '\n';
  const n = Math.ceil(40e6 / line.length);
  fs.writeFileSync(dir + '/numbers.ndjson', line.repeat(n));
}
console.log('written to', dir);
