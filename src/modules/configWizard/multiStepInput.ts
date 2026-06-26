import * as vscode from 'vscode';

// A small multi-step wizard built on VS Code's QuickInput. Each step is an async function that calls
// input.showQuickPick / input.showInputBox and returns the next step (or undefined to finish). The
// Back button rewinds to the previous step; Esc cancels the whole flow (InputFlowAction.cancel).
// This is the lightweight state machine the new-server setup wizard runs on; nothing here is
// WireFerry-specific so it stays a generic helper.

class InputFlowAction {
  static back = new InputFlowAction();
  static cancel = new InputFlowAction();
  private constructor() {
    /* sentinel */
  }
}

type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

interface QuickPickParameters<T extends vscode.QuickPickItem> {
  title: string;
  step: number;
  totalSteps: number;
  items: T[];
  activeItem?: T;
  placeholder: string;
  ignoreFocusOut?: boolean;
}

interface InputBoxParameters {
  title: string;
  step: number;
  totalSteps: number;
  value: string;
  prompt: string;
  password?: boolean;
  placeholder?: string;
  validate?: (value: string) => Promise<string | undefined> | string | undefined;
  ignoreFocusOut?: boolean;
}

export class MultiStepInput {
  static async run(start: InputStep): Promise<boolean> {
    const input = new MultiStepInput();
    return input.stepThrough(start);
  }

  private current?: vscode.QuickInput;
  private steps: InputStep[] = [];

  // Returns true if the flow completed, false if the user cancelled (Esc / closed the input).
  private async stepThrough(start: InputStep): Promise<boolean> {
    let step: InputStep | void = start;
    while (step) {
      this.steps.push(step);
      if (this.current) {
        this.current.enabled = false;
        this.current.busy = true;
      }
      try {
        step = await step(this);
      } catch (err) {
        if (err === InputFlowAction.back) {
          this.steps.pop();
          step = this.steps.pop();
        } else if (err === InputFlowAction.cancel) {
          this.dispose();
          return false;
        } else {
          this.dispose();
          throw err;
        }
      }
    }
    this.dispose();
    return true;
  }

  async showQuickPick<T extends vscode.QuickPickItem>(params: QuickPickParameters<T>): Promise<T> {
    const disposables: vscode.Disposable[] = [];
    try {
      return await new Promise<T>((resolve, reject) => {
        const input = vscode.window.createQuickPick<T>();
        input.title = params.title;
        input.step = params.step;
        input.totalSteps = params.totalSteps;
        input.placeholder = params.placeholder;
        input.items = params.items;
        input.ignoreFocusOut = params.ignoreFocusOut !== false;
        if (params.activeItem) {
          input.activeItems = [params.activeItem];
        }
        input.buttons = this.steps.length > 1 ? [vscode.QuickInputButtons.Back] : [];
        disposables.push(
          input.onDidTriggerButton(button => {
            if (button === vscode.QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            }
          }),
          input.onDidAccept(() => {
            const [selected] = input.selectedItems;
            if (selected) {
              resolve(selected);
            }
          }),
          input.onDidHide(() => reject(InputFlowAction.cancel))
        );
        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach(d => d.dispose());
    }
  }

  async showInputBox(params: InputBoxParameters): Promise<string> {
    const disposables: vscode.Disposable[] = [];
    try {
      return await new Promise<string>((resolve, reject) => {
        const input = vscode.window.createInputBox();
        input.title = params.title;
        input.step = params.step;
        input.totalSteps = params.totalSteps;
        input.value = params.value || '';
        input.prompt = params.prompt;
        input.password = params.password === true;
        input.placeholder = params.placeholder;
        input.ignoreFocusOut = params.ignoreFocusOut !== false;
        input.buttons = this.steps.length > 1 ? [vscode.QuickInputButtons.Back] : [];
        let validating = Promise.resolve<string | undefined>(undefined);
        disposables.push(
          input.onDidTriggerButton(button => {
            if (button === vscode.QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            }
          }),
          input.onDidAccept(async () => {
            const value = input.value;
            input.enabled = false;
            input.busy = true;
            const message = params.validate ? await params.validate(value) : undefined;
            if (!message) {
              resolve(value);
            } else {
              input.validationMessage = message;
            }
            input.enabled = true;
            input.busy = false;
          }),
          input.onDidChangeValue(async text => {
            if (!params.validate) {
              return;
            }
            const current = params.validate(text);
            validating = Promise.resolve(current);
            const message = await current;
            if (validating === current) {
              input.validationMessage = message;
            }
          }),
          input.onDidHide(() => reject(InputFlowAction.cancel))
        );
        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach(d => d.dispose());
    }
  }

  private dispose(): void {
    if (this.current) {
      this.current.dispose();
      this.current = undefined;
    }
  }
}
