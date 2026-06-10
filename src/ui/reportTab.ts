import * as vscode from 'vscode';

// Open a report in an editor TAB instead of (only) a transient notification. The tab stays open
// until the user closes it, its text is selectable/copyable, and file paths in it can be opened —
// so the user can read at leisure what a popup flashes too quickly to catch. Best-effort: a failure
// to open the tab must never break the calling flow.
export async function openReportTab(content: string): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (e) {
    /* ignore — the notification already conveyed the gist */
  }
}
