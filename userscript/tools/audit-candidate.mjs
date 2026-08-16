import fs from 'node:fs';
import crypto from 'node:crypto';

const candidate = fs.readFileSync('candidate/Weekend-Wegwijzer.user.js', 'utf8').replace(/\r\n/g, '\n');
const stable = fs.readFileSync('stable/Weekend-Wegwijzer.user.js', 'utf8').replace(/\r\n/g, '\n');

const requirements = [
  ['candidate name', /@name\s+Weekend Wegwijzer Candidate/],
  ['candidate namespace', /@namespace\s+weekend-wegwijzer-candidate/],
  ['candidate version', /@version\s+4\.0\.2/],
  ['candidate update URL', /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/vanderzeemichael45-bit\/Skyscanner\/main\/userscript\/candidate\/Weekend-Wegwijzer\.user\.js/],
  ['Skyscanner scope', /@match\s+https:\/\/www\.skyscanner\.nl\/\*/],
  ['document-start', /@run-at\s+document-start/],
  ['JSON capture', /web-unified-search/],
  ['DOM fallback', /source:\s*'DOM'/],
  ['adaptive workers', /effectiveWorkerLimit/],
  ['cache recovery', /clearOldestCacheHalf/],
  ['interceptor guard', /INTERCEPTOR_MARK/],
  ['worker cleanup', /pagehide.*cleanupPendingWorkers/],
  ['diagnostic download', /downloadDiagnostics/],
  ['door-to-door price model', /function priceModel/],
  ['effective stay model', /function effectiveStayHours/],
  ['optional one stop', /maxStops/],
  ['block classification', /BOT_CHECK/],
  ['progressive results', /ww-more-results/],
  ['availability windows', /customWindow/],
  ['Thursday long weekend', /thu-mon/],
  ['home deadline', /expectedHomeArrivalMinutes/],
  ['diagnostic result snapshot', /resultSnapshot/]
];

const failures = requirements.filter(([, pattern]) => !pattern.test(candidate)).map(([label]) => label);
if (candidate.includes('@grant        GM_')) failures.push('unexpected privileged GM grant');
if (!/@version\s+3\.7\.1/.test(stable)) failures.push('stable is not original 3.7.1');

if (failures.length) {
  console.error(`Candidate audit failed: ${failures.join(', ')}`);
  process.exit(1);
}

const stableHash = crypto.createHash('sha256').update(stable).digest('hex');
const expectedStableHash = fs.readFileSync('tests/stable.sha256', 'utf8').trim();
if (stableHash !== expectedStableHash) {
  console.error(`Stable changed unexpectedly: ${stableHash}`);
  process.exit(1);
}
console.log(`candidate audit: OK (4.0.2); stable 3.7.1 sha256 ${stableHash}`);
