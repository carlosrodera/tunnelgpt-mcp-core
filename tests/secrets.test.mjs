import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { detectSecretContent, redactPotentialSecrets } from '../dist/core/secrets.js';

const run = promisify(execFile);

test('whitespace-heavy malformed assignments finish without polynomial backtracking', async () => {
  const moduleUrl = new URL('../dist/core/secrets.js', import.meta.url).href;
  const script = `
    import { detectSecretContent, redactPotentialSecrets } from ${JSON.stringify(moduleUrl)};
    const spaces = ' '.repeat(120_000);
    for (const value of [
      'password: ' + spaces + 'x\\u2028y',
      'password: ' + String.fromCharCode(96, 96) + spaces + '!',
      'password: abcdefghijklmnop' + spaces + '!',
    ]) {
      detectSecretContent(value);
      redactPotentialSecrets(value);
    }
    process.stdout.write('COMPLETE');
  `;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
    timeout: 3000,
    maxBuffer: 1024,
  });
  assert.equal(stdout, 'COMPLETE');
});

test('literal parsing keeps quoted secrets, comments and explicit placeholders distinct', () => {
  const value = 'credential_fixture_012345';
  for (const literal of [value, `'${value}'`, `"${value}"`, '`' + value + '`']) {
    for (const suffix of ['', ';', ' , // fixture comment', ' # fixture comment']) {
      const text = `password = ${literal}${suffix}`;
      assert.deepEqual(detectSecretContent(text), { type: 'credential_assignment', line: 1 });
      assert.equal(redactPotentialSecrets(text), text.replace(value, '[REDACTED]'));
    }
  }
  for (const expression of ['environment.password', '"example"', '"your_api_key_here"', '`' + '${TOKEN_FROM_ENV}' + '`', `'${value}' + other`, value + ' invalid']) {
    const text = `token: ${expression}`;
    assert.equal(detectSecretContent(text), undefined);
    assert.equal(redactPotentialSecrets(text), text);
  }
  assert.deepEqual(detectSecretContent(`label\napi_key = "${value}"; // fixture`), { type: 'credential_assignment', line: 2 });
  const escaped = 'credential_fixture_\\"_012345';
  assert.deepEqual(detectSecretContent(`password = "${escaped}"`), { type: 'credential_assignment', line: 1 });
  assert.equal(redactPotentialSecrets(`password = "${escaped}"`), 'password = "[REDACTED]"');
});
