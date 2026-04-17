import { describe, expect, test } from 'bun:test';

const runIntegration = process.env['STRONGBOX_CLI_INTEGRATION'] === '1';

describe.skipIf(!runIntegration)('integration', () => {
  test.todo('diagnose finds at least one manifest on a machine with Strongbox Pro', () => {});
  test.todo('status round-trips against a running, unlocked Strongbox', () => {});
  test.todo('url returns at least one credential for a known URL', () => {});
});

if (!runIntegration) {
  test('integration tests require STRONGBOX_CLI_INTEGRATION=1', () => {
    expect(runIntegration).toBe(false);
  });
}
