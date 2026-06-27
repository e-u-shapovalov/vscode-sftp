/* tslint:disable max-classes-per-file */
import * as querystring from 'querystring';
import { Uri } from 'vscode';
import { toLocalPath, toRemotePath, isSubpathOf, isRemoteSubpathOf } from '../helper';
import { REMOTE_SCHEME } from '../constants';

function createUriString(authority: string, filepath: string, query: { [x: string]: any }) {
  // remove leading slash
  const normalizedPath = encodeURIComponent(filepath.replace(/^\/+/, ''));

  // vscode.Uri will call decodeURIComponent for query, so we must encode it first.
  const queryStr = encodeURIComponent(querystring.stringify(query));
  return `${REMOTE_SCHEME}://${authority}/${normalizedPath}?${queryStr}`;
}

// tslint:disable-next-line class-name
class _Resource {
  private readonly _uri: Uri;
  private readonly _fsPath: string;
  private readonly _remoteId: number;
  private readonly _profile?: string;

  constructor(uri: Uri) {
    this._uri = uri;
    if (UResource.isRemote(uri)) {
      // @types/node 18 types querystring.parse() without a generic; each value is
      // string | string[] | undefined. Our remote URIs always carry plain strings.
      const query = querystring.parse(this._uri.query);
      this._remoteId = parseInt(query.remoteId as string, 10);
      // Optional: which profile (tree root) this resource belongs to. Absent on plain (single-host)
      // configs and on pre-profile URIs, so old URIs keep behaving exactly as before.
      this._profile = (query.profile as string) || undefined;

      if (query.fsPath === undefined) {
        throw new Error(`fsPath is missing in remote uri ${this._uri}.`);
      }

      this._fsPath = query.fsPath as string;
    } else {
      this._fsPath = this._uri.fsPath;
    }
  }

  get remoteId(): number {
    return this._remoteId;
  }

  get profile(): string | undefined {
    return this._profile;
  }

  get uri(): Uri {
    return this._uri;
  }

  get fsPath() {
    return this._fsPath;
  }
}

interface RemoteResourceConfig {
  remote: {
    host: string;
    port: number;
  };
  remoteId: number;
  // Which profile (tree root) the resource belongs to; omitted for plain single-host configs.
  profile?: string;
}

type ResourceConfig = RemoteResourceConfig & {
  localBasePath: string;
  remoteBasePath: string;
};

export type Resource = InstanceType<typeof _Resource>;

// Universal resource
export default class UResource {
  private readonly _localResouce: Resource;
  private readonly _remoteResouce: Resource;

  static isRemote(uri: Uri) {
    return uri.scheme === REMOTE_SCHEME;
  }

  static makeResource(config: RemoteResourceConfig & { fsPath: string } | Uri): Resource {
    if (config instanceof Uri) {
      return new _Resource(config);
    }

    if (!config.remote) {
      return new _Resource(Uri.file(config.fsPath));
    }

    const {
      remote: { host, port },
      remoteId,
      fsPath,
      profile,
    } = config;
    const remote = `${host}${port ? `:${port}` : ''}`;
    const query: { [x: string]: any } = {
      remoteId,
      fsPath,
    };
    // Only carry the profile when set, so plain (single-host) URIs stay byte-identical to before.
    if (profile) {
      query.profile = profile;
    }

    // uri.fsPath will always be current platform specific.
    // We need to store valid fsPath for remote platform.
    return new _Resource(Uri.parse(createUriString(remote, fsPath, query)));
  }

  static updateResource(resource: Resource, delta: { remotePath: string }): Resource {
    const uri = resource.uri;
    const { remotePath } = delta;
    const query = querystring.parse(resource.uri.query);
    query.fsPath = delta.remotePath;

    return new _Resource(Uri.parse(createUriString(uri.authority, remotePath, query)));
  }

  static from(
    uri: Uri,
    root: Resource | ResourceConfig,
    options: { allowOutsideRoot?: boolean } = {}
  ): UResource {
    if ((root as Resource).fsPath) {
      return new UResource(new _Resource(uri), root as Resource);
    }

    const { localBasePath, remoteBasePath, remote, remoteId, profile } = root as ResourceConfig;
    // Opt-out for a single user-initiated command (Edit in Local) that intentionally READS a remote
    // path ABOVE the configured scope. It relaxes ONLY the remote-scheme branch below (downloading a
    // file the user navigated to outside remotePath, with a warning where the local copy lands). The
    // local→remote branch stays strict regardless of this flag, so a local URI can never map a WRITE
    // above the root; and auto-sync/watcher/upload never pass it, so they keep the full boundary.
    const allowOutsideRoot = options.allowOutsideRoot === true;

    let localResouce: Resource;
    let remoteResouce: Resource;
    if (uri.scheme === REMOTE_SCHEME) {
      const remotePath = UResource.makeResource(uri).fsPath;
      // Containment: a forged remote: URI (same remoteId, but an fsPath like /etc/passwd) would make
      // toLocalPath emit a `..`-escaping local path. Reject anything outside the configured remote
      // root, and re-check that the mapped local path stays inside the local context, so a crafted
      // URI can't read outside the remote root or write outside the workspace.
      if (!allowOutsideRoot && !isRemoteSubpathOf(remoteBasePath, remotePath)) {
        throw new Error(
          `Refusing remote path outside the configured root (${remoteBasePath}): ${remotePath}`
        );
      }
      const localFsPath = toLocalPath(remotePath, remoteBasePath, localBasePath);
      if (!allowOutsideRoot && !isSubpathOf(localBasePath, localFsPath)) {
        throw new Error(`Refusing remote path that maps outside the local context: ${localFsPath}`);
      }
      localResouce = new _Resource(Uri.file(localFsPath));
      remoteResouce = new _Resource(uri);
    } else {
      const remoteFsPath = toRemotePath(uri.fsPath, localBasePath, remoteBasePath);
      // Mirror the containment guard the remote branch above already has: a local path outside the
      // configured context makes path.relative emit `..`, so remoteFsPath escapes above the remote
      // root (uploading/overwriting an unrelated file on the server). Check the COMPUTED remote path
      // rather than the input — path.relative folds the drive-letter case on Windows, so this avoids
      // the false rejections a raw isSubpathOf(localBasePath, uri.fsPath) would hit.
      // UNCONDITIONAL — allowOutsideRoot relaxes only remote-side reads, never a local→remote mapping,
      // so a local URI can never be coaxed into writing above the root even when the flag is set.
      if (!isRemoteSubpathOf(remoteBasePath, remoteFsPath)) {
        throw new Error(
          `Refusing local path outside the configured context (${localBasePath}): ${uri.fsPath}`
        );
      }
      remoteResouce = UResource.makeResource({
        remote,
        fsPath: remoteFsPath,
        remoteId,
        profile,
      });
      localResouce = new _Resource(uri);
    }

    return new UResource(localResouce, remoteResouce);
  }

  private constructor(localResouce: Resource, remoteResouce: Resource) {
    this._localResouce = localResouce;
    this._remoteResouce = remoteResouce;
  }

  get localFsPath(): string {
    return this._localResouce.fsPath;
  }

  get remoteFsPath(): string {
    return this._remoteResouce.fsPath;
  }

  get localUri(): Uri {
    return this._localResouce.uri;
  }

  get remoteUri(): Uri {
    return this._remoteResouce.uri;
  }
}
