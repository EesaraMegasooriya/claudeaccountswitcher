import { execFile } from 'child_process';
import { constants, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

// Where Claude Code keeps its login:
//  - macOS: OAuth tokens in the login Keychain, account profile in ~/.claude.json
//  - Linux/Windows: OAuth tokens in ~/.claude/.credentials.json, profile in ~/.claude.json
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

export const claudeJsonPath = path.join(os.homedir(), '.claude.json');
const credentialsFilePath = path.join(os.homedir(), '.claude', '.credentials.json');

export interface OAuthAccount {
  accountUuid?: string;
  emailAddress?: string;
  organizationUuid?: string;
  organizationName?: string;
  displayName?: string;
  [key: string]: unknown;
}

function run(cmd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.toString().trim() || err.message));
      } else {
        resolve(stdout.toString());
      }
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

async function keychainAccountName(): Promise<string> {
  // Reuse whatever account name Claude Code wrote the item under; fall back to the OS user.
  try {
    const out = await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE]);
    const match = out.match(/"acct"<blob>="([^"]*)"/);
    if (match) {
      return match[1];
    }
  } catch {
    // no existing item
  }
  return os.userInfo().username;
}

export async function readCredentials(): Promise<string | undefined> {
  if (isMac) {
    try {
      return (await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'])).trim();
    } catch {
      return undefined;
    }
  }
  try {
    return await fs.readFile(credentialsFilePath, 'utf8');
  } catch {
    return undefined;
  }
}

export async function writeCredentials(secret: string): Promise<void> {
  if (isMac) {
    // Feed the command through `security -i` on stdin so the token never appears in the process list.
    // Hex-encoding (-X) sidesteps quoting of the JSON payload.
    const account = (await keychainAccountName()).replace(/["\\]/g, '');
    const hex = Buffer.from(secret, 'utf8').toString('hex');
    await run('security', ['-i'], `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${account}" -X ${hex}\n`);
    return;
  }
  await fs.mkdir(path.dirname(credentialsFilePath), { recursive: true });
  await fs.writeFile(credentialsFilePath, secret, { encoding: 'utf8', mode: 0o600 });
}

async function readClaudeJson(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(claudeJsonPath, 'utf8'));
  } catch {
    return {};
  }
}

export async function readOAuthAccount(): Promise<OAuthAccount | undefined> {
  const data = await readClaudeJson();
  return (data.oauthAccount as OAuthAccount) ?? undefined;
}

export async function writeOAuthAccount(account: OAuthAccount): Promise<void> {
  // Only touch oauthAccount; every other key in ~/.claude.json is preserved.
  const data = await readClaudeJson();
  data.oauthAccount = account;
  const tmp = `${claudeJsonPath}.switcher-${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, claudeJsonPath);
}

export function accountId(account: OAuthAccount | undefined): string | undefined {
  if (!account?.accountUuid) {
    return undefined;
  }
  return `${account.accountUuid}:${account.organizationUuid ?? ''}`;
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, isWindows ? constants.F_OK : constants.X_OK);
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Finds the Claude Code CLI on PATH or in the usual install locations. */
export async function findClaudeBinary(): Promise<string | undefined> {
  const names = isWindows ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  dirs.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  );
  if (isWindows && process.env.APPDATA) {
    dirs.push(path.join(process.env.APPDATA, 'npm'));
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}
