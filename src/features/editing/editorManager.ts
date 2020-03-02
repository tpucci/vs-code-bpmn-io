import * as vscode from 'vscode';

import { Disposable } from '../../dispose';

export class EditorManager implements vscode.CustomTextEditorProvider {

  private readonly _editors = new Set<Editor>();
  private _activeEditor: Editor | undefined;

  constructor(
    private readonly extensionRoot: vscode.Uri
  ) { }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewEditor: vscode.WebviewPanel,
  ): Promise<void> {
    const editor = new Editor(this.extensionRoot, document.uri, webviewEditor);
    this._editors.add(editor);
    this.setActiveEditor(editor);

    webviewEditor.onDidDispose(() => { this._editors.delete(editor); });

    webviewEditor.onDidChangeViewState(() => {
      if (webviewEditor.active) {
        this.setActiveEditor(editor);
      } else if (this._activeEditor === editor && !webviewEditor.active) {
        this.setActiveEditor(undefined);
      }
    });
  }

  public get activeEditor() { return this._activeEditor; }

  private setActiveEditor(value: Editor | undefined): void {
    this._activeEditor = value;
    this.setPreviewActiveContext(!!value);
  }

  private setPreviewActiveContext(value: boolean) {
    vscode.commands.executeCommand('setContext', 'bpmnEditorFocus', value);
  }
}

const enum PreviewState {
  Disposed,
  Visible,
  Active,
}

class Editor extends Disposable {

  private _editorState = PreviewState.Visible;

  private readonly emptyPngDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42gEFAPr/AP///wAI/AL+Sr4t6gAAAABJRU5ErkJggg==';

  constructor(
    private readonly extensionRoot: vscode.Uri,
    private readonly resource: vscode.Uri,
    private readonly webviewEditor: vscode.WebviewPanel,
  ) {
    super();
    const resourceRoot = resource.with({
      path: resource.path.replace(/\/[^\/]+?\.\w+$/, '/'),
    });

    webviewEditor.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        resourceRoot,
        extensionRoot,
      ]
    };

    this._register(webviewEditor.onDidChangeViewState(() => {
      this.update();
      this.webviewEditor.webview.postMessage({ type: 'setActive', value: this.webviewEditor.active });
    }));

    this._register(webviewEditor.onDidDispose(() => {
      this._editorState = PreviewState.Disposed;
    }));

    const watcher = this._register(vscode.workspace.createFileSystemWatcher(resource.fsPath));
    this._register(watcher.onDidChange(e => {
      if (e.toString() === this.resource.toString()) {
        this.render();
      }
    }));

    this._register(watcher.onDidDelete(e => {
      if (e.toString() === this.resource.toString()) {
        this.webviewEditor.dispose();
      }
    }));

    vscode.workspace.fs.stat(resource).then(() => {
      this.update();
    });

    this.render();
    this.update();
    this.webviewEditor.webview.postMessage({ type: 'setActive', value: this.webviewEditor.active });
  }

  private async render() {
    if (this._editorState !== PreviewState.Disposed) {
      this.webviewEditor.webview.html = await this.getWebiewContents();
    }
  }

  private update() {
    if (this._editorState === PreviewState.Disposed) {
      return;
    }

    if (this.webviewEditor.active) {
      this._editorState = PreviewState.Active;
    } else {
      if (this._editorState === PreviewState.Active) {
      }
      this._editorState = PreviewState.Visible;
    }
  }

  private async getWebiewContents(): Promise<string> {
    const version = Date.now().toString();
    const settings = {
      isMac: process.platform === 'darwin',
      src: await this.getResourcePath(this.webviewEditor, this.resource, version),
    };

    const nonce = Date.now().toString();

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">

	<!-- Disable pinch zooming -->
	<meta name="viewport"
		content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">

	<title>foo</title

	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: ${this.webviewEditor.webview.cspSource}; script-src 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}';">
	<meta id="image-preview-settings" data-settings="${escapeAttribute(JSON.stringify(settings))}">
</head>
<body>
	Hello world
</body>
</html>`;
  }

  private async getResourcePath(webviewEditor: vscode.WebviewPanel, resource: vscode.Uri, version: string): Promise<string> {
    if (resource.scheme === 'git') {
      const stat = await vscode.workspace.fs.stat(resource);
      if (stat.size === 0) {
        return this.emptyPngDataUri;
      }
    }

    // Avoid adding cache busting if there is already a query string
    if (resource.query) {
      return webviewEditor.webview.asWebviewUri(resource).toString(true);
    }
    return webviewEditor.webview.asWebviewUri(resource).with({ query: `version=${version}` }).toString(true);
  }

  private extensionResource(path: string) {
    return this.webviewEditor.webview.asWebviewUri(this.extensionRoot.with({
      path: this.extensionRoot.path + path
    }));
  }
}

function escapeAttribute(value: string | vscode.Uri): string {
  return value.toString().replace(/"/g, '&quot;');
}
