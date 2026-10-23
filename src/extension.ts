import * as fs from 'fs';
import * as vscode from 'vscode';
import { AccountNode, AccountsViewProvider, SavedAccount } from './accountsView';
import {
  OAuthAccount,
  accountId,
  claudeJsonPath,
  findClaudeBinary,
  readCredentials,
  readOAuthAccount,
  writeCredentials,
  writeOAuthAccount,
} from './claudeAuth';

interface StoredLogin {
  credentials: string;
  oauthAccount: OAuthAccount;
}

const ACCOUNTS_KEY = 'claudeAccounts.accounts';
const secretKey = (id: string) => `claudeAccounts.login.${id}`;

let context: vscode.ExtensionContext;
let statusBar: vscode.StatusBarItem;
let view: AccountsViewProvider;
const promptedIds = new Set<string>();
let busy = false;

function getAccounts(): SavedAccount[] {
  return context.globalState.get<SavedAccount[]>(ACCOUNTS_KEY, []);
}

async function setAccounts(accounts: SavedAccount[]): Promise<void> {
  await context.globalState.update(ACCOUNTS_KEY, accounts);
  await vscode.commands.executeCommand('setContext', 'claudeAccounts.hasAccounts', accounts.length > 0);
}

function config() {
  return vscode.workspace.getConfiguration('claudeAccounts');
}

/** Snapshot the login Claude Code is currently using. Returns the saved account, or undefined if not logged in. */
async function snapshotCurrent(label?: string): Promise<SavedAccount | undefined> {
  const [credentials, oauthAccount] = await Promise.all([readCredentials(), readOAuthAccount()]);
  const id = accountId(oauthAccount);
  if (!credentials || !oauthAccount || !id) {
    return undefined;
  }
  await context.secrets.store(secretKey(id), JSON.stringify({ credentials, oauthAccount } satisfies StoredLogin));

  const accounts = getAccounts();
  const existing = accounts.find((a) => a.id === id);
  const account: SavedAccount = {
    id,
    label: label ?? existing?.label ?? oauthAccount.emailAddress ?? id,
    email: oauthAccount.emailAddress,
    organization: oauthAccount.organizationName,
    savedAt: Date.now(),
  };
  await setAccounts(existing ? accounts.map((a) => (a.id === id ? account : a)) : [...accounts, account]);
  return account;
}

async function refreshUi(): Promise<void> {
  view.refresh();

  const current = await readOAuthAccount();
  const id = accountId(current);
  const saved = getAccounts().find((a) => a.id === id);
  const name = saved?.label ?? current?.emailAddress;

  if (!config().get<boolean>('showStatusBar', true)) {
    statusBar.hide();
    return;
  }
  statusBar.text = name ? `$(account) Claude: ${name}` : '$(account) Claude: not logged in';
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown(`**Active Claude Code account**\n\n`);
  tooltip.appendMarkdown(current?.emailAddress ? `${current.emailAddress}` : 'None');
  if (current?.organizationName) {
    tooltip.appendMarkdown(`\n\n${current.organizationName}`);
  }
  if (id && !saved) {
    tooltip.appendMarkdown(`\n\n_Not saved yet — run "Save Current Login as Account"._`);
  }
  tooltip.appendMarkdown(`\n\nClick to switch accounts.`);
  statusBar.tooltip = tooltip;
  statusBar.show();
}

async function switchTo(target: SavedAccount): Promise<void> {
  const raw = await context.secrets.get(secretKey(target.id));
  if (!raw) {
    vscode.window.showErrorMessage(`No stored login for "${target.label}". Log in to it again and save it.`);
    return;
  }
  const login: StoredLogin = JSON.parse(raw);

  busy = true;
  try {
    // Claude Code rotates refresh tokens, so re-save the outgoing account before replacing it.
    const currentId = accountId(await readOAuthAccount());
    if (currentId === target.id) {
      vscode.window.showInformationMessage(`"${target.label}" is already active.`);
      return;
    }
    if (currentId && getAccounts().some((a) => a.id === currentId)) {
      await snapshotCurrent();
    }

    await writeCredentials(login.credentials);
    await writeOAuthAccount(login.oauthAccount);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to switch Claude account: ${(err as Error).message}`);
    return;
  } finally {
    busy = false;
  }

  await refreshUi();
  const choice = await vscode.window.showInformationMessage(
    `Switched Claude Code to "${target.label}". Restart running Claude sessions to pick it up.`,
    'Open Claude Terminal'
  );
  if (choice) {
    await openClaudeTerminal();
  }
}

function shellQuote(file: string): string {
  if (!/[\s"'&()]/.test(file)) {
    return file;
  }
  return process.platform === 'win32' ? `& "${file}"` : `'${file.replace(/'/g, `'\\''`)}'`;
}

async function openClaudeTerminal(): Promise<vscode.Terminal | undefined> {
  const configured = config().get<string>('claudePath', '').trim();
  const binary = configured || (await findClaudeBinary());
  if (!binary) {
    const choice = await vscode.window.showErrorMessage(
      'Could not find the Claude Code CLI. Install it, or set "claudeAccounts.claudePath" to the full path of `claude`.',
      'Open Settings',
      'Install Guide'
    );
    if (choice === 'Open Settings') {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'claudeAccounts.claudePath');
    } else if (choice === 'Install Guide') {
      void vscode.env.openExternal(vscode.Uri.parse('https://docs.claude.com/en/docs/claude-code/setup'));
    }
    return undefined;
  }
  const terminal = vscode.window.createTerminal({ name: 'Claude Code' });
  terminal.show();
  terminal.sendText(configured || shellQuote(binary));
  return terminal;
}

/** Commands invoked from the side panel pass the clicked node; from the palette they get nothing. */
async function resolveTarget(arg: unknown, placeHolder: string): Promise<SavedAccount | undefined> {
  if (arg instanceof AccountNode && arg.account) {
    return arg.account;
  }
  const accounts = getAccounts();
  if (accounts.length === 0) {
    vscode.window.showInformationMessage('No saved Claude accounts yet.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    accounts.map((a) => ({ label: a.label, description: a.email, account: a })),
    { placeHolder }
  );
  return pick?.account;
}

async function cmdSwitch(arg?: unknown): Promise<void> {
  if (arg instanceof AccountNode && arg.account) {
    return switchTo(arg.account);
  }

  const currentId = accountId(await readOAuthAccount());
  type Item = vscode.QuickPickItem & { run: () => Promise<void> };

  const items: Item[] = getAccounts().map((a) => ({
    label: `${a.id === currentId ? '$(check)' : '$(account)'} ${a.label}`,
    description: a.email !== a.label ? a.email : undefined,
    detail: a.organization,
    run: () => switchTo(a),
  }));
  items.push(
    { label: '', kind: vscode.QuickPickItemKind.Separator, run: async () => {} },
    { label: '$(add) Add account…', run: cmdAddAccount },
    { label: '$(save) Save current login', run: cmdSaveCurrent }
  );

  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a Claude account' });
  await pick?.run();
}

async function cmdSaveCurrent(): Promise<void> {
  const oauthAccount = await readOAuthAccount();
  if (!accountId(oauthAccount)) {
    const choice = await vscode.window.showWarningMessage(
      'Claude Code is not logged in. Start Claude Code and type /login first.',
      'Open Claude Terminal'
    );
    if (choice) {
      await openClaudeTerminal();
    }
    return;
  }
  const existing = getAccounts().find((a) => a.id === accountId(oauthAccount));
  const label = await vscode.window.showInputBox({
    prompt: 'Name for this account',
    value: existing?.label ?? oauthAccount?.emailAddress ?? '',
  });
  if (label === undefined) {
    return;
  }
  const saved = await snapshotCurrent(label.trim() || undefined);
  if (saved) {
    vscode.window.showInformationMessage(`Saved Claude account "${saved.label}".`);
  }
  await refreshUi();
}

async function cmdAddAccount(): Promise<void> {
  // Keep the current login so it isn't lost when /login replaces it.
  const current = await snapshotCurrent();
  if (current) {
    promptedIds.delete(current.id);
  }
  await refreshUi();
  if (await openClaudeTerminal()) {
    vscode.window.showInformationMessage(
      'In the Claude Code terminal, type /login and sign in with the other account. It will be detected automatically.'
    );
  }
}

async function cmdRemove(arg?: unknown): Promise<void> {
  const account = await resolveTarget(arg, 'Remove which saved account?');
  if (!account) {
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Remove saved account "${account.label}"? The active Claude Code login is not changed.`,
    { modal: true },
    'Remove'
  );
  if (confirm !== 'Remove') {
    return;
  }
  await context.secrets.delete(secretKey(account.id));
  await setAccounts(getAccounts().filter((a) => a.id !== account.id));
  await refreshUi();
}

async function cmdRename(arg?: unknown): Promise<void> {
  const account = await resolveTarget(arg, 'Rename which account?');
  if (!account) {
    return;
  }
  const label = await vscode.window.showInputBox({ prompt: 'New name', value: account.label });
  if (!label?.trim()) {
    return;
  }
  await setAccounts(getAccounts().map((a) => (a.id === account.id ? { ...a, label: label.trim() } : a)));
  await refreshUi();
}

async function onClaudeJsonChanged(): Promise<void> {
  if (busy) {
    return;
  }
  await refreshUi();

  const current = await readOAuthAccount();
  const id = accountId(current);
  if (!id || getAccounts().some((a) => a.id === id) || promptedIds.has(id)) {
    return;
  }
  if (!config().get<boolean>('promptToSaveNewLogins', true)) {
    return;
  }
  promptedIds.add(id);
  const choice = await vscode.window.showInformationMessage(
    `Claude Code is logged in as ${current?.emailAddress ?? 'a new account'}. Save it for quick switching?`,
    'Save',
    'Not now'
  );
  if (choice === 'Save') {
    const saved = await snapshotCurrent();
    if (saved) {
      vscode.window.showInformationMessage(`Saved Claude account "${saved.label}".`);
    }
    await refreshUi();
  }
}

export function activate(ctx: vscode.ExtensionContext): void {
  context = ctx;

  view = new AccountsViewProvider(async () => {
    const current = await readOAuthAccount();
    return { accounts: getAccounts(), activeId: accountId(current), activeEmail: current?.emailAddress };
  });
  ctx.subscriptions.push(vscode.window.registerTreeDataProvider('claudeAccounts.accounts', view));

  statusBar = vscode.window.createStatusBarItem('claudeAccounts.status', vscode.StatusBarAlignment.Right, 100);
  statusBar.name = 'Claude Account';
  statusBar.command = 'claudeAccounts.switch';
  ctx.subscriptions.push(statusBar);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('claudeAccounts.switch', cmdSwitch),
    vscode.commands.registerCommand('claudeAccounts.saveCurrent', cmdSaveCurrent),
    vscode.commands.registerCommand('claudeAccounts.addAccount', cmdAddAccount),
    vscode.commands.registerCommand('claudeAccounts.remove', cmdRemove),
    vscode.commands.registerCommand('claudeAccounts.rename', cmdRename),
    vscode.commands.registerCommand('claudeAccounts.openTerminal', openClaudeTerminal),
    vscode.commands.registerCommand('claudeAccounts.refresh', refreshUi),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeAccounts')) {
        void refreshUi();
      }
    })
  );

  // Polling survives the atomic rename Claude Code uses when rewriting the file.
  const listener = () => void onClaudeJsonChanged();
  fs.watchFile(claudeJsonPath, { interval: 2000 }, listener);
  ctx.subscriptions.push({ dispose: () => fs.unwatchFile(claudeJsonPath, listener) });

  void vscode.commands.executeCommand('setContext', 'claudeAccounts.hasAccounts', getAccounts().length > 0);
  void onClaudeJsonChanged();
}

export async function deactivate(): Promise<void> {
  // Keep the active account's (possibly refreshed) tokens current.
  const id = accountId(await readOAuthAccount());
  if (id && getAccounts().some((a) => a.id === id)) {
    await snapshotCurrent();
  }
}
