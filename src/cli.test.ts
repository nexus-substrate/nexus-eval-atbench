import { afterEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };
import { main } from './cli.js';

describe('cli', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints package version for --version', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const code = await main(['node', 'cli', '--version']);

    expect(code).toBe(0);
    expect(writeSpy).toHaveBeenCalledWith(`nexus-eval-atbench ${packageJson.version}\n`);
  });

  it('prints help for --help', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const code = await main(['node', 'cli', '--help']);

    expect(code).toBe(0);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('nexus-eval-atbench --help'));
  });
});
