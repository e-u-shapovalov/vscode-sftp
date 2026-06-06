import * as vscode from 'vscode';
import { COMMAND_OPEN_CONNECTION_IN_TERMINAL } from '../constants';
import { getAllFileService } from '../modules/serviceManager';
import { ExplorerRoot } from '../modules/remoteExplorer';
import { interpolate } from '../utils';
import { checkCommand } from './abstract/createCommand';

const isWindows = process.platform === 'win32';

// Connection fields come from .vscode/sftp.json, which an untrusted workspace can supply.
// The SSH command is typed into an integrated terminal via terminal.sendText(), so any
// shell control character in these fields could chain a second command. Validate first.
const SHELL_CONTROL_CHARS = /[;&|`$(){}<>\n\r]/;
const HOST_RE = /^[A-Za-z0-9._\-:\[\]]+$/;
const USERNAME_RE = /^[A-Za-z0-9._\-\\@]+$/;

function assertNoShellControl(value: string, fieldName: string) {
  if (SHELL_CONTROL_CHARS.test(value)) {
    throw new Error(`Cannot open SSH terminal: "${fieldName}" contains shell control characters.`);
  }
}

function validateSshConfig(config: {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
}) {
  if (!HOST_RE.test(String(config.host))) {
    throw new Error(`Cannot open SSH terminal: invalid host "${config.host}".`);
  }
  if (!USERNAME_RE.test(String(config.username))) {
    throw new Error(`Cannot open SSH terminal: invalid username "${config.username}".`);
  }
  const port = Number(config.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Cannot open SSH terminal: invalid port "${config.port}".`);
  }
  if (config.privateKeyPath) {
    assertNoShellControl(config.privateKeyPath, 'privateKeyPath');
    if (config.privateKeyPath.indexOf('"') !== -1) {
      throw new Error('Cannot open SSH terminal: privateKeyPath contains a double quote.');
    }
  }
}

function shouldUseAgent(config) {
  return typeof config.agent === 'string' && config.agent.length > 0;
}

function shouldUseKey(config) {
  return typeof config.privateKeyPath === 'string' && config.privateKeyPath.length > 0;
}

function adaptPath(filepath) {
  if (isWindows) {
    return filepath.replace(/\\\\/g, '\\');
  }

  // convert to unix style
  return filepath.replace(/\\\\/g, '/').replace(/\\/g, '/');
}

function getSshCommand(
  config: { host: string; port: number; username: string },
  extraOption?: string
) {
  let sshStr = `ssh -t ${config.username}@${config.host} -p ${config.port}`;
  if (extraOption) {
    sshStr += ` ${extraOption}`;
  }
  // sshStr += ` "cd \\"${config.workingDir}\\"; exec \\$SHELL -l"`;
  return sshStr;
}

export default checkCommand({
  id: COMMAND_OPEN_CONNECTION_IN_TERMINAL,

  async handleCommand(exploreItem?: ExplorerRoot) {
    let remoteConfig;
    if (exploreItem && exploreItem.explorerContext) {
      remoteConfig = exploreItem.explorerContext.config;
      if (remoteConfig.protocol !== 'sftp') {
        return;
      }
    } else {
      const remoteItems = getAllFileService().reduce<
        { label: string; description: string; config: any }[]
      >((result, fileService) => {
        const config = fileService.getConfig();
        if (config.protocol === 'sftp') {
          result.push({
            label: config.name || config.remotePath,
            description: config.host,
            config,
          });
        }
        return result;
      }, []);
      if (remoteItems.length <= 0) {
        return;
      }

      const item = await vscode.window.showQuickPick(remoteItems, {
        placeHolder: 'Select a folder...',
      });
      if (item === undefined) {
        return;
      }

      remoteConfig = item.config;
    }

    const sshConfig = {
      host: remoteConfig.host,
      port: remoteConfig.port,
      username: remoteConfig.username,
    };

    try {
      validateSshConfig({ ...sshConfig, privateKeyPath: remoteConfig.privateKeyPath });
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
      return;
    }

    const terminal = vscode.window.createTerminal(remoteConfig.name);
    let sshCommand;
    if (shouldUseAgent(remoteConfig)) {
      sshCommand = getSshCommand(sshConfig);
    } else if (shouldUseKey(remoteConfig)) {
      sshCommand = getSshCommand(sshConfig, `-i "${adaptPath(remoteConfig.privateKeyPath)}"`);
    } else {
      sshCommand = getSshCommand(sshConfig);
    }

    if (remoteConfig.sshCustomParams) {
      const customParams = interpolate(remoteConfig.sshCustomParams, {
        remotePath: remoteConfig.remotePath,
      });
      try {
        assertNoShellControl(customParams, 'sshCustomParams');
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
        return;
      }
      sshCommand = sshCommand + ' ' + customParams;
    }

    terminal.sendText(sshCommand);
    terminal.show();
  },
});
