// MUST stay above the ssh2 import: ssh2's kex.js destructures createDiffieHellman* from 'crypto'
// the moment it loads, so our crypto patch (applied as a side effect of this module) has to run
// first. ssh2 is an external (see webpack.config.js), required at this point in source order.
import './legacyDh';
import { Client } from 'ssh2';
import upath from '../upath';
import RemoteClient, { ErrorCode, ConnectOption, Config } from './remoteClient';
import localFs from '../localFs';
import { FileSystem, RemoteFileSystem, SFTPFileSystem } from '../fs';
import logger from '../../logger';
import CustomError from '../customError';

const DEFAULT_MAX_OPEN_FD_NUM = 222;

export default class SSHClient extends RemoteClient {
  private sftp: any;
  private hoppingClients: SSHClient[];
  // Per-instance (was a module-level `let`): a second profile with its own limit must not
  // silently change the limit of every already-connected client.
  private _maxOpenFdNum: number = DEFAULT_MAX_OPEN_FD_NUM;
  private _opendFdNum: number = 0;
  // Each queued fd request carries `exec` (run the real open when capacity frees up) and `fail`
  // (reject the awaiting caller) so a disconnect can drain the queue instead of wedging it forever.
  private _queuedFdRequireCall: Array<{ exec: () => any; fail: (err: Error) => void }> = [];
  private _ended: boolean = false;

  _initClient() {
    return new Client();
  }

  _hasProvideAuth(connectOption: ConnectOption) {
    return (
      // interactiveAuth : boolean
      connectOption.interactiveAuth === true ||
      // or interactiveAuth : array of phrases
      (Array.isArray(connectOption.interactiveAuth) && !!connectOption.interactiveAuth.length) ||
      // or key defined
      ['password', 'agent', 'privateKeyPath'].some(
        // tslint:disable-next-line triple-equals
        key => connectOption[key] != undefined
      )
    );
  }

  async _doConnect(
    connectOption: ConnectOption,
    config: Config
  ): Promise<void> {
    const { hop, ...option } = connectOption;

    let lastOption: ConnectOption = option;
    let fs: FileSystem | RemoteFileSystem = localFs;
    let sock;
    if (
      (Array.isArray(hop) && hop.length > 0) ||
      (hop && Object.keys(hop).length > 0)
    ) {
      this.hoppingClients = [];
      // IMPORTANT: hop entries are the prefix (jumps/bastions) we connect through first.
      // The de-hopped `option` (target) is always the final destination (lastOption).
      // Previous construction put `option` first which inverted the chain and caused
      // wrong hosts, wrong fs used for key reads, and auth mix-ups.
      const hopList: ConnectOption[] = Array.isArray(hop) ? hop : [hop];
      const connectOptions = hopList;

      for (let index = 0; index < connectOptions.length; index++) {
        const curOpt = connectOptions[index];
        if (curOpt.port === undefined) {
          curOpt.port = 22;
        }
        const preClient = this.hoppingClients[index - 1];
        if (preClient) {
          sock = await this._makeHopping(preClient, curOpt.host, curOpt.port);
          fs = new SFTPFileSystem(upath, {
            client: preClient,
          });
        }

        if (curOpt.privateKeyPath) {
          const buffer = await fs.readFile(curOpt.privateKeyPath);
          curOpt.privateKey = buffer.toString();
        }

        const client = new SSHClient(curOpt);
        this.hoppingClients.push(client);
        // Use a config without onPasswordEntered/onPassphraseEntered for hops.
        // Hops intentionally do not support keychain "secretStorage" save yet
        // (see sanitize + warn in fileService). Forwarding the callbacks would
        // overwrite the *target's* entered values captured for post-success offer-to-save,
        // causing the wrong secret to be offered/stored under the target's identity.
        const hopConnectConfig = { askForPasswd: config.askForPasswd };
        await client.connect({ ...curOpt, sock }, hopConnectConfig);
      }

      if (this.hoppingClients.length > 0) {
        const lastClient = this.hoppingClients[this.hoppingClients.length - 1];
        sock = await this._makeHopping(
          lastClient,
          lastOption.host,
          lastOption.port
        );
        fs = new SFTPFileSystem(upath, {
          client: lastClient,
        });
      }
    }

    if (lastOption.privateKeyPath) {
      const buffer = await fs.readFile(lastOption.privateKeyPath);
      lastOption.privateKey = buffer.toString();
    }

    await this._connectSSHClient(this._client, { ...lastOption, sock }, config);
    this.sftp = await this._getSftp(this._client);

    // Fresh connection — drop fd bookkeeping left over from a previous (re)connect, or the
    // counter starts pre-inflated and the queue replays calls against a dead sftp stream.
    this._opendFdNum = 0;
    this._queuedFdRequireCall = [];
    this._ended = false;

    if (lastOption.limitOpenFilesOnRemote) {
      if (typeof lastOption.limitOpenFilesOnRemote !== 'boolean') {
        this._maxOpenFdNum = Math.max(127, lastOption.limitOpenFilesOnRemote);
      }
      this._limitSftpFileDescriptor();
    }
  }

  // connect1(readline): Promise<void> {
  //   const {
  //     interactiveAuth,
  //     password,
  //     privateKeyPath,
  //     connectTimeout,
  //     ...option // tslint:disable-line
  //   } = this.getOption();
  //   return new Promise<void>((resolve, reject) => {
  //     const connectWithCredential = (passwd?, privateKey?) =>
  //       this.client
  //         .on('ready', () => {
  //           this.client.sftp((err, sftp) => {
  //             if (err) {
  //               reject(err);
  //             }

  //             this.sftp = sftp;
  //             resolve();
  //           });
  //         })
  //         .on('error', err => {
  //           reject(err);
  //         })
  //         .connect({
  //           keepaliveInterval: 1000 * 30,
  //           keepaliveCountMax: 2,
  //           readyTimeout: interactiveAuth ? Math.max(60 * 1000, connectTimeout) : connectTimeout,
  //           ...option,
  //           privateKey,
  //           password: passwd,
  //           tryKeyboard: interactiveAuth,
  //         });

  //     if (interactiveAuth) {
  //       this.client.on('keyboard-interactive', function redo(
  //         name,
  //         instructions,
  //         instructionsLang,
  //         prompts,
  //         finish,
  //         stackedAnswers
  //       ) {
  //         const answers = stackedAnswers || [];
  //         if (answers.length < prompts.length) {
  //           readline(prompts[answers.length].prompt).then(answer => {
  //             answers.push(answer);
  //             redo(name, instructions, instructionsLang, prompts, finish, answers);
  //           });
  //         } else {
  //           finish(answers);
  //         }
  //       });
  //     }

  //     if (!privateKeyPath) {
  //       connectWithCredential(password);
  //       return;
  //     }

  //     fs.readFile(privateKeyPath, (err, data) => {
  //       if (err) {
  //         reject(err);
  //         return;
  //       }
  //       connectWithCredential(password, data);
  //     });
  //   });
  // }

  private _limitSftpFileDescriptor() {
    if (!this.sftp) {
      return;
    }

    const sftp = this.sftp;
    sftp._stream.open = this._hookCallForRequestFileDescriptor(
      sftp._stream.open
    );
    sftp._stream.opendir = this._hookCallForRequestFileDescriptor(
      sftp._stream.opendir
    );
    sftp._stream.close = this._hookCallForReleaseFileDescriptor(
      sftp._stream.close
    );
  }

  private _hookCallForReleaseFileDescriptor(fn) {
    const self = this;
    return function releaseFileDescriptor() {
      const last = arguments.length - 1;
      const args = Array.prototype.slice.call(arguments, 0, last);
      const cb = arguments[last];
      function wrapped() {
        // 队列到下一周期执行, 确保 cb 先执行.
        Promise.resolve().then(() => {
          // Skip once the connection is gone — end() has already drained/failed the queue.
          if (!self._ended && self._queuedFdRequireCall.length > 0) {
            // FIFO: shift, not pop — under load a LIFO queue starves the earliest open() calls.
            const queuedCall = self._queuedFdRequireCall.shift()!;
            queuedCall.exec();
          }
        });
        self._opendFdNum -= 1;
        cb.apply(this, arguments);
      }
      args.push(wrapped);
      return fn.apply(this, args);
    };
  }

  private _hookCallForRequestFileDescriptor(fn) {
    const self = this;
    return function requestFileDescriptor() {
      const last = arguments.length - 1;
      const args = Array.prototype.slice.call(arguments, 0, last);
      const cb = arguments[last];
      function wrapped(err) {
        // Count only successful opens: a failed open never gets a close, so counting it would
        // ratchet the counter up until every request parks in the queue forever.
        if (!err) {
          self._opendFdNum += 1;
        }
        cb.apply(this, arguments);
      }
      args.push(wrapped);

      // Connection already closed: fail fast so the awaiting open()/opendir() rejects instead of
      // queuing a call that can never run (which used to hang the transfer forever).
      if (self._ended) {
        wrapped.call(this, new Error('SFTP connection closed'));
        return;
      }

      if (self._opendFdNum >= self._maxOpenFdNum) {
        self._queuedFdRequireCall.push({
          exec: () => fn.apply(this, args),
          fail: err => wrapped.call(this, err),
        });
        return;
      }

      return fn.apply(this, args);
    };
  }

  private async _connectSSHClient(
    client,
    remoteOption: ConnectOption,
    config: Config
  ): Promise<any> {
    const {
      interactiveAuth,
      connectTimeout,
      ...option // tslint:disable-line
    } = remoteOption;

    // Compare to `true` explicitly: a real passphrase is a string, `true` means "ask". Keychain
    // sentinels never reach here — resolveCredentials() (fileService) has already turned
    // "secretStorage"/"prompt" into either a real string or `true` before connect.
    if (option.passphrase === true) {
      option.passphrase = await config.askForPasswd(
        `[${option.host}]: Enter your passphrase`
      );
      if (option.passphrase === undefined) {
        throw new CustomError(ErrorCode.CONNECT_CANCELLED, 'cancelled');
      }
      if (config.onPassphraseEntered) {
        config.onPassphraseEntered(option.passphrase as string);
      }
    }

    return new Promise<void>((resolve, reject) => {
      if (interactiveAuth) {
        client.on('keyboard-interactive', function redo(
          name,
          instructions,
          instructionsLang,
          prompts,
          finish,
          stackedAnswers
        ) {
          const answers = stackedAnswers ||
            // load predefined answeres if any
            (Array.isArray(interactiveAuth) ? interactiveAuth : undefined) ||
            [];
          if (answers.length < prompts.length) {
            config
              .askForPasswd(
                `[${option.host}]: ${prompts[answers.length].prompt}`
              )
              .then(answer => {
                if (answer === undefined) {
                  return reject(
                    new CustomError(ErrorCode.CONNECT_CANCELLED, 'cancelled')
                  );
                }

                answers.push(answer);
                redo(
                  name,
                  instructions,
                  instructionsLang,
                  prompts,
                  finish,
                  answers
                );
              });
          } else {
            finish(answers);
          }
        });
      }

      client
        .on('ready', resolve)
        .on('error', err => {
          reject(new Error(`[${option.host}]: ${err.message}`));
        })
        .on('close', () => this.end())
        .on('end', () => this.end())
        .connect({
          keepaliveInterval: 1000 * 30, // 30 secs, original
          // keepaliveInterval: 1000 * 600, // 10 mins
          // keepaliveInterval: 1000 * 1800, // 30 mins
          keepaliveCountMax: 2, // x2 original
          // keepaliveCountMax: 3, // x3
          // keepaliveCountMax: 6, // x6
          readyTimeout: interactiveAuth
            ? Math.max(60 * 1000, connectTimeout || 0) // 60 secs, original
            // ? Math.max(1800 * 1000, connectTimeout || 0) // 30 mins
            // ? Math.max(10800 * 1000, connectTimeout || 0) // 180 mins
            : connectTimeout,
          ...option,
          tryKeyboard: !!interactiveAuth,
        });
    });
  }

  private _getSftp(client): Promise<any> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          return reject(err);
        }

        resolve(sftp);
      });
    });
  }

  private _makeHopping(sshClient: SSHClient, dstHost, dstPort): Promise<any> {
    logger.info(`hopping from ${sshClient._option.host} to ${dstHost}`);
    return new Promise((resolve, reject) => {
      // Create a connect form 127.0.0.1:port to dstHost:dstPort
      sshClient._client.forwardOut(
        '127.0.0.1',
        sshClient._option.port,
        dstHost,
        dstPort,
        (error, stream) => {
          if (error) {
            return reject(error);
          }

          resolve(stream);
        }
      );
    });
  }

  end() {
    // ssh2 emits both 'close' and 'end', and each handler calls end() — make it idempotent so
    // the hop chain isn't torn down twice (and the in-place reverse() doesn't flip back).
    if (this._ended) {
      return;
    }
    this._ended = true;

    // Reject every queued fd request so its awaiting caller errors out instead of hanging forever;
    // reset the counter so a future reconnect on this instance starts clean.
    const queued = this._queuedFdRequireCall;
    this._queuedFdRequireCall = [];
    this._opendFdNum = 0;
    queued.forEach(item => {
      try {
        item.fail(new Error('SFTP connection closed'));
      } catch (e) {
        // best-effort — never let queue teardown throw out of end()
      }
    });

    this._client.end();

    if (this.hoppingClients) {
      // last connect first end
      this.hoppingClients
        .slice()
        .reverse()
        .forEach(client => client.end());
    }
  }

  getFsClient() {
    return this.sftp;
  }

  // Run a command over an SSH exec channel and resolve its stdout. Rejects on a non-zero exit or a
  // channel error. Used for cheap server-side aggregates (e.g. `du`) instead of walking over SFTP.
  // The CALLER is responsible for shell-escaping any path it injects into the command.
  exec(command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this._client.exec(command, (err: Error | undefined, stream: any) => {
        if (err) {
          return reject(err);
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (chunk: any) => {
          stdout += chunk;
        });
        stream.stderr.on('data', (chunk: any) => {
          stderr += chunk;
        });
        stream
          .on('close', (code: number) => {
            if (code === 0) {
              resolve(stdout);
            } else {
              reject(new Error(`command exited with ${code}: ${(stderr || stdout).trim()}`));
            }
          })
          .on('error', reject);
      });
    });
  }
}
