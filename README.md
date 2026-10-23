# Claude Account Switcher

Keep several Claude Code logins (for example a personal and a work account) and switch between them with one click — from the side panel, the status bar, or the Command Palette.

> Unofficial community extension. Not affiliated with or endorsed by Anthropic. Use of each account remains subject to Anthropic's terms.

## Features

- **Side panel** — a *Claude Accounts* view in the Activity Bar lists your saved accounts. Click one to switch; rename or remove it with the inline buttons.
- **Status bar** — shows the active account; click it to switch.
- **Automatic detection** — when you log in to a new account with `/login`, the extension offers to save it.
- **Secure storage** — saved logins are kept in VS Code's encrypted Secret Storage, never in plain settings.
- **Cross-platform** — macOS (Keychain), Linux and Windows (`~/.claude/.credentials.json`).

## Getting started

1. Make sure [Claude Code](https://docs.claude.com/en/docs/claude-code/setup) is installed and you are logged in.
2. Open the **Claude Accounts** panel in the Activity Bar and click **Save Current Login**.
3. Click **+ (Add Account)**. A Claude Code terminal opens — type `/login` and sign in with the other account. The extension detects it and offers to save it.
4. Click any saved account to make it active.

After switching, restart any running Claude Code sessions (terminal or the Claude Code panel) so they pick up the new login.

## Commands

| Command | Description |
| --- | --- |
| `Claude Accounts: Switch Account` | Pick an account to make active |
| `Claude Accounts: Save Current Login as Account` | Save the login Claude Code is using now |
| `Claude Accounts: Add Account (Log In)` | Open Claude Code to log in with another account |
| `Claude Accounts: Rename Saved Account` | Change an account's display name |
| `Claude Accounts: Remove Saved Account` | Forget a saved account (does not log you out) |
| `Claude Accounts: Open Claude Code Terminal` | Start Claude Code in a new terminal |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `claudeAccounts.claudePath` | `""` | Full path to the `claude` CLI. Empty = auto-detect. |
| `claudeAccounts.promptToSaveNewLogins` | `true` | Offer to save logins that aren't saved yet. |
| `claudeAccounts.showStatusBar` | `true` | Show the active account in the status bar. |

## How it works

Claude Code stores its login in two places: the OAuth tokens (macOS Keychain item `Claude Code-credentials`, or `~/.claude/.credentials.json` elsewhere) and the account profile (`oauthAccount` in `~/.claude.json`). Switching swaps exactly those two things; every other setting in `~/.claude.json` is left untouched.

Because Claude Code refreshes its tokens over time, the extension re-saves the outgoing account right before each switch and when VS Code closes, so stored logins stay valid.

## Limitations

- A custom `CLAUDE_CONFIG_DIR` is not supported.
- Claude Code sessions that are already running keep using the previous account until restarted.
- If a saved login expires (e.g. after a long time unused), log in to it again and save it.

## Development

```bash
npm install
npm run compile      # or: npm run watch
# Press F5 in VS Code to launch an Extension Development Host
npm run package      # builds a .vsix
```
