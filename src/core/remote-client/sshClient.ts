// MUST stay above the ssh2 import: ssh2's kex.js destructures createDiffieHellman* from 'crypto'
// the moment it loads, so our crypto patch (applied as a side effect of this module) has to run
// first. ssh2 is an external (see webpack.config.js), required at this point in source order.
import './legacyDh';
import { Client } from 'ssh2';
import RemoteClient, { ErrorCode, ConnectOption, Config } from './remoteClient';
import localFs from '../localFs';
import logger from '../../logger';
import CustomError from '../customError';
import { parseId, UserIdentity } from '../../helper/identity';
import {
  isAuthPasswordPrompt,
  parseSentinelCode,
  sanitizeSuOutput,
  stripBeforeBegin,
  stripTrailingSentinel,
} from '../../helper/suOutput';

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
  // The connected user's identity (uid + groups), fetched once via `id` and reused for the advisory
  // write-permission hints in the tree. A failed fetch is not cached, so a later call can retry.
  private _identity: Promise<UserIdentity> | null = null;

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
      ['password', 'agent', 'privateKey', 'privateKeyPath'].some(
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

      try {
        for (let index = 0; index < connectOptions.length; index++) {
          const curOpt = connectOptions[index];
          if (curOpt.port === undefined) {
            curOpt.port = 22;
          }
          const preClient = this.hoppingClients[index - 1];
          if (preClient) {
            sock = await this._makeHopping(preClient, curOpt.host, curOpt.port);
          }

          // Private keys live on the CLIENT machine: ssh2 runs locally and authenticates each hop
          // through the forwarded socket, so the key bytes must come from the local FS — never from a
          // previous hop's remote FS (which would read an unrelated file off the bastion). hop key
          // paths are resolved to local absolute paths in fileService.getCompleteConfig.
          if (curOpt.privateKeyPath) {
            const buffer = await localFs.readFile(curOpt.privateKeyPath);
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
        }
      } catch (err) {
        // A failed jump must not leave earlier hops connected: tear the chain down (last opened
        // first) before propagating, or every aborted multi-hop attempt leaks an ssh2.Client/socket.
        for (let i = this.hoppingClients.length - 1; i >= 0; i--) {
          try {
            this.hoppingClients[i].end();
          } catch {
            /* ignore */
          }
        }
        this.hoppingClients = [];
        throw err;
      }
    }

    // Target key: also read locally (see the hop loop above). Before this fix it was read through
    // the last hop's SFTP, so a hop + key target authenticated with a file from the bastion.
    if (lastOption.privateKeyPath) {
      const buffer = await localFs.readFile(lastOption.privateKeyPath);
      lastOption.privateKey = buffer.toString();
    }

    await this._connectSSHClient(this._client, { ...lastOption, sock }, config);
    this.sftp = await this._getSftp(this._client);

    // Fresh connection — drop fd bookkeeping left over from a previous (re)connect, or the
    // counter starts pre-inflated and the queue replays calls against a dead sftp stream.
    this._opendFdNum = 0;
    this._queuedFdRequireCall = [];
    this._ended = false;
    // A reconnect may be under a different user — drop the cached `id` so write-hints recompute.
    this._identity = null;

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
            // load predefined answers if any — COPY them, so pushing the user's typed replies
            // (OTP / 2FA codes) below never mutates the live config array the Remote Explorer
            // tree keeps, which would leave typed secrets sitting in long-lived UI state.
            (Array.isArray(interactiveAuth) ? [...interactiveAuth] : undefined) ||
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
      // The handshake already passed readyTimeout, but the SFTP subsystem request itself can hang
      // on a half-broken server. Bound it so a pending operation rejects instead of waiting forever.
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error('SFTP subsystem request timed out'));
      }, 20000);
      client.sftp((err, sftp) => {
        if (settled) {
          // The timeout already rejected this request. If the subsystem still came up afterwards,
          // close it — otherwise the SFTP channel leaks for the lifetime of the SSH connection
          // (the per-connection channel limit is small, ~10, so this matters on flaky links).
          if (!err && sftp && typeof sftp.end === 'function') {
            try {
              sftp.end();
            } catch {
              /* best-effort: nothing to do if closing the orphaned channel fails */
            }
          }
          return;
        }
        settled = true;
        clearTimeout(timer);
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

    // Guarantee hop teardown even if the main client's end() throws — otherwise a throw here leaks
    // every bastion/jump connection in the chain.
    try {
      this._client.end();
    } finally {
      if (this.hoppingClients) {
        // last connect first end
        this.hoppingClients
          .slice()
          .reverse()
          .forEach(client => {
            try {
              client.end();
            } catch {
              /* ignore */
            }
          });
      }
    }
  }

  getFsClient() {
    return this.sftp;
  }

  // The connected user's identity (uid + effective group ids), memoized per connection. Runs `id`
  // once; a failure clears the cache so a later call retries rather than sticking with the error.
  getIdentity(): Promise<UserIdentity> {
    if (!this._identity) {
      this._identity = this.exec('id').then(
        out => {
          const parsed = parseId(out);
          if (!parsed) {
            this._identity = null;
            throw new Error(`could not parse id output: ${String(out).trim().slice(0, 120)}`);
          }
          return parsed;
        },
        err => {
          this._identity = null;
          throw err;
        }
      );
    }
    return this._identity;
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

  // The host/port of the connection this client actually talks to (the final target for a hop chain).
  // Used to key the cached root password so two different servers behind the same hostname string
  // (e.g. localhost:2201 vs localhost:2202 tunnels) never share a password.
  getEndpoint(): { host: string; port: number } {
    return { host: this._option.host, port: this._option.port };
  }

  // Run `command` AS ROOT via `su -`, feeding `password` to su's terminal prompt over an allocated
  // PTY (su reads the password from the controlling tty, not stdin — so a PTY is mandatory). The
  // command runs in a POSIX shell (`-s /bin/sh`) so `$?` is the exit code regardless of root's login
  // shell, and under `LC_ALL=C` so su's prompt/error text is the English we match. The CALLER must
  // shell-escape any path inside `command`.
  //
  // Resolves { code, output } with the INNER command's exit status (parsed from a sentinel we append,
  // NOT su's own exit code). A wrong root password rejects with an Error carrying `.authFailed = true`
  // so the caller can re-prompt. `output` is sanitized (password + auth phase + marker stripped) before
  // it ever leaves this method, so a caller that surfaces it can't leak the password.
  execRoot(
    command: string,
    password: string,
    asUser?: string,
    rawOutput = false
  ): Promise<{ code: number; output: string }> {
    const sentinel = '__WF_RC_';
    // Random per call, so login-shell noise (MOTD/profile) or the command's own data can't contain the exact
    // marker and fool stripBeforeBegin's first-match. Echoed BEFORE the command → everything before it is
    // discarded. The exit-code marker AFTER the command carries the command's OWN status ($? = the inner
    // command's code; deliberately NO pipe, so nothing hides the producer's failure).
    const beginMarker = `__WF_BEGIN_${Math.random().toString(36).slice(2) || '0'}__`;
    // Reset PATH so find/head/rm/chmod/chown/cat resolve to the REAL system binaries even under
    // `su - <owner>`, whose login profile could prepend a malicious directory (PATH-hijack) when that owner
    // has a writable home. All the tools we run live in these standard dirs.
    const payload = `PATH=/usr/bin:/bin:/usr/sbin:/sbin; echo '${beginMarker}'; ${command}; echo "${sentinel}$?__"`;
    // Single-quote the whole payload for `su … -c '...'`, escaping embedded quotes the POSIX way.
    const quoted = `'${payload.replace(/'/g, `'\\''`)}'`;
    // Target user: default (undefined / 'root') = `su -` (root). A named user runs `su - <user>` with
    // THAT user's password. The caller (privilegedExec) validates the user token to a safe
    // [a-z_][a-z0-9_-]* shape, so it can't inject shell — it is never placed inside the quoted payload.
    const target = asUser && asUser !== 'root' ? ` ${asUser}` : '';
    // `/usr/bin/env` by ABSOLUTE path (not PATH-resolved): otherwise the login user could shadow `env` in
    // their own PATH with a fake that prints "Password:" and captures the root password we send to it (the
    // inner payload's PATH reset is too late — it runs INSIDE su). env then sets a clean PATH before resolving
    // `su`, so `su` can't be shadowed either. Still a single command (no shell `VAR=val` assignment), so it
    // works from both sh and csh login shells.
    const suCommand = `/usr/bin/env PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C su -${target} -s /bin/sh -c ${quoted}`;
    // Threat-model boundary: this runs THROUGH the login user's own SSH shell/environment, so that environment
    // is inherently trusted. A login account whose environment an attacker controls (LD_PRELOAD, a DEBUG trap,
    // a shadowed login shell) can intercept the root password by means NO client-side command construction can
    // prevent — escalating to root through such an account is unsafe by nature. The absolute `/usr/bin/env`
    // above only closes the narrower PATH name-shadow of `env`/`su`; it is not a defence against a hostile
    // login environment, which is out of scope (the user owns the account they are escalating from).
    // One wall-clock cap for the whole exec. It covers both waiting for the prompt AND running the
    // command, so a passwordless `su` (which never prompts) still gets the full budget for a slow
    // `chmod/chown -R`. A wrong password does NOT depend on this: su exits and 'close' fires promptly.
    const SU_TIMEOUT_MS = 600000;

    // For errors/logs: strip password + marker (defence in depth). For the SUCCESS result we also drop the
    // login-shell noise before the begin marker and — when the caller reads the output as DATA (rawOutput,
    // e.g. a file's bytes or a listing) — we DON'T strip the password from it, because the command's stdout
    // must survive intact (the auth phase is discarded separately, so the password can't be in it anyway;
    // stripping it would silently corrupt any file/name that merely contains the password as a substring).
    const sanitize = (raw: string): string => sanitizeSuOutput(raw, password, sentinel);
    const resolveOutput = (raw: string): string => {
      const afterBegin = stripBeforeBegin(raw, beginMarker);
      // rawOutput = the caller reads this as DATA (a file's bytes / a listing) → return it VERBATIM, dropping
      // ONLY the trailing marker. Normalise the PTY's \n→\r\n translation back to \n so a text file matches
      // the server byte-for-byte (a binary file may still look garbled — documented, same as preview).
      return rawOutput
        ? stripTrailingSentinel(afterBegin, sentinel).replace(/\r\n/g, '\n')
        : sanitizeSuOutput(afterBegin, password, sentinel);
    };

    return new Promise((resolve, reject) => {
      this._client.exec(suCommand, { pty: true }, (err: Error | undefined, stream: any) => {
        if (err) {
          return reject(err);
        }
        let output = '';
        // Raw stdout as BYTES. Decoding each chunk on its own (`output += chunk.toString()`) corrupts a
        // multibyte UTF-8 char split across a chunk boundary — fine for the ASCII prompt/sentinel matching we
        // do on `output`, but NOT for a file's bytes returned to the caller, which we decode once from these.
        let rawChunks: Buffer[] = [];
        let passwordSent = false;
        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        const finish = (fn: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          stream.removeListener('data', onChunk);
          if (stream.stderr) {
            stream.stderr.removeListener('data', onChunk);
          }
          fn();
        };
        timer = setTimeout(() => {
          finish(() => {
            try {
              stream.close();
            } catch {
              // best effort
            }
            reject(new Error('su timed out'));
          });
        }, SU_TIMEOUT_MS);

        const onChunk = (chunk: any) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          rawChunks.push(buf);
          output += buf.toString();
          if (passwordSent) {
            return;
          }
          // Send the password ONLY during the auth phase — before the payload's begin marker appears. After it,
          // su has already run the command, so a "password:" in the command's OWN output (a config line, a
          // listing) is DATA, not su's prompt; matching it there would push the password into the running
          // command, truncate the captured data, and can leak it under a passwordless su (see the predicate).
          if (isAuthPasswordPrompt(output, beginMarker)) {
            passwordSent = true;
            try {
              stream.write(`${password}\n`);
            } catch {
              // stream already closed — the close handler will settle
            }
            // Discard everything up to and including the auth phase from BOTH buffers: the command hasn't run
            // yet, so no command output is lost, but the prompt (and any echoed password) is dropped.
            output = '';
            rawChunks = [];
          }
        };
        stream.on('data', onChunk);
        if (stream.stderr) {
          stream.stderr.on('data', onChunk);
        }
        stream
          .on('close', (code: number) => {
            finish(() => {
              // Decode the accumulated bytes ONCE — correct across chunk boundaries (see rawChunks).
              const decoded = Buffer.concat(rawChunks).toString('utf8');
              const code2 = parseSentinelCode(decoded, sentinel);
              if (code2 !== null) {
                resolve({ code: code2, output: resolveOutput(decoded) });
                return;
              }
              // No sentinel => the payload never ran. Only classify as an auth rejection (so the caller
              // re-prompts) when we actually sent a password AND see a known rejection phrase — a bare
              // "su: command not found" must fall through to the generic error, not loop on the password.
              if (
                passwordSent &&
                /authentication failure|incorrect password|permission denied|sorry, try again/i.test(decoded)
              ) {
                const e: any = new Error('su authentication failed');
                e.authFailed = true;
                reject(e);
                return;
              }
              reject(new Error(`su failed (exit ${code}): ${sanitize(decoded).slice(-200)}`));
            });
          })
          .on('error', (e: Error) => finish(() => reject(e)));
      });
    });
  }
}
