import * as vscode from 'vscode';

export interface SavedAccount {
  id: string;
  label: string;
  email?: string;
  organization?: string;
  savedAt: number;
}

export interface ViewState {
  accounts: SavedAccount[];
  activeId?: string;
  activeEmail?: string;
}

export class AccountNode extends vscode.TreeItem {
  constructor(
    public readonly account: SavedAccount | undefined,
    active: boolean,
    unsavedEmail?: string
  ) {
    super(account?.label ?? unsavedEmail ?? 'Current login', vscode.TreeItemCollapsibleState.None);

    if (!account) {
      // The login Claude Code is using right now, which hasn't been saved yet.
      this.description = 'active · not saved';
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      this.contextValue = 'unsaved';
      this.tooltip = 'Claude Code is logged in with this account, but it is not saved. Save it to switch back later.';
      return;
    }

    const details = [account.email !== account.label ? account.email : undefined, account.organization].filter(Boolean);
    this.description = active ? ['active', ...details].join(' · ') : details.join(' · ');
    this.iconPath = active
      ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('account');
    this.contextValue = active ? 'account.active' : 'account';
    this.tooltip = new vscode.MarkdownString(
      `**${account.label}**\n\n${account.email ?? ''}\n\n${account.organization ?? ''}\n\n` +
        (active ? '_Active in Claude Code_' : 'Click to switch to this account')
    );
    if (!active) {
      this.command = { command: 'claudeAccounts.switch', title: 'Switch', arguments: [this] };
    }
  }
}

export class AccountsViewProvider implements vscode.TreeDataProvider<AccountNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly getState: () => Promise<ViewState>) {}

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(node: AccountNode): vscode.TreeItem {
    return node;
  }

  async getChildren(): Promise<AccountNode[]> {
    const { accounts, activeId, activeEmail } = await this.getState();
    const nodes = accounts.map((a) => new AccountNode(a, a.id === activeId));
    if (activeId && !accounts.some((a) => a.id === activeId)) {
      nodes.unshift(new AccountNode(undefined, true, activeEmail));
    }
    return nodes;
  }
}
