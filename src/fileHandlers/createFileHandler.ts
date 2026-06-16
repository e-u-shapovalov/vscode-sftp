import { Uri } from 'vscode';
import app from '../app';
import { UResource, FileService, ServiceConfig } from '../core';
import logger from '../logger';
import { getFileService } from '../modules/serviceManager';

interface FileHandlerConfig {
  _?: boolean;
}

export interface FileHandlerContext {
  target: UResource;
  fileService: FileService;
  config: ServiceConfig;
  // Set when this context was built for a specific profile (e.g. by allHandleCtxFromUri); lets
  // callers report which profile a per-profile result belongs to.
  profile?: string;
}

type FileHandlerContextMethod<R = void> = (this: FileHandlerContext) => R;
type FileHandlerContextMethodArg1<A, R = void> = (this: FileHandlerContext, a: A) => R;

interface FileHandlerOption<T> {
  name: string;
  handle: FileHandlerContextMethodArg1<T, Promise<any>>;
  afterHandle?: FileHandlerContextMethod<void | Promise<void>>;
  config?: FileHandlerConfig;
  transformOption?: FileHandlerContextMethod<T>;
}

export function handleCtxFromUri(uri: Uri): FileHandlerContext {
  const fileService = getFileService(uri);
  if (!fileService) {
    throw new Error(`Config Not Found. (${uri.toString(true)})`);
  }
  // For a remote (tree) URI, operate against the config of the ROOT the node belongs to — that is the
  // node's profile, which can differ from the globally-active profile (each profile is its own tree
  // root). Local URIs have no profile dimension, so they keep using the active-profile config.
  let config: ServiceConfig | undefined;
  let profile: string | undefined;
  if (UResource.isRemote(uri)) {
    const root = app.remoteExplorer.findRoot(uri);
    if (root) {
      config = root.explorerContext.config;
      profile = root.explorerContext.profile;
    }
  }
  if (!config) {
    config = fileService.getConfig();
    // A local URI on a profiles config is associated with the active profile's root, so a reveal /
    // refresh built from it lands on the right tree root.
    if (fileService.getAvailableProfiles().length > 0) {
      profile = app.state.profile || undefined;
    }
  }
  const target = UResource.from(uri, {
    localBasePath: fileService.baseDir,
    remoteBasePath: config.remotePath,
    remoteId: fileService.id,
    remote: {
      host: config.host,
      port: config.port,
    },
    profile,
  });

  return {
    fileService,
    config,
    target,
  };
}

export function allHandleCtxFromUri(uri: Uri): Array<FileHandlerContext> {
  const fileService = getFileService(uri);
  if (!fileService) {
    throw new Error(`Config Not Found. (${uri.toString(true)})`);
  }

  // One context per profile, each carrying that profile's merged config + name, so callers can both
  // target the right host AND report which profile a per-profile result belongs to.
  return fileService.getAvailableProfiles().map(profile => {
    const config = fileService.getConfig(profile);
    const target = UResource.from(uri, {
      localBasePath: fileService.baseDir,
      remoteBasePath: config.remotePath,
      remoteId: fileService.id,
      remote: {
        host: config.host,
        port: config.port,
      },
      profile,
    });

    return {
      fileService,
      config,
      target,
      profile,
    };
  });
}

export default function createFileHandler<T>(
  handlerOption: FileHandlerOption<T>
): (ctx: FileHandlerContext | Uri, option?: Partial<T>) => Promise<void> {
  async function fileHandle(ctx: Uri | FileHandlerContext, option?: T) {
    const handleCtx = ctx instanceof Uri ? handleCtxFromUri(ctx) : ctx;
    const { target } = handleCtx;

    const invokeOption = handlerOption.transformOption
      ? handlerOption.transformOption.call(handleCtx)
      : {};
    if (option) {
      Object.assign(invokeOption, option);
    }

    if (invokeOption.ignore && invokeOption.ignore(target.localFsPath)) {
      // Skipped because the path matches the sync `ignore` filter. Trace it so a silently dropped
      // operation is at least visible in the log (explicit create/delete commands opt out of this).
      logger.trace(`skip ${handlerOption.name} (ignored)`, target.localFsPath);
      return;
    }

    logger.trace(`handle ${handlerOption.name} for`, target.localFsPath);

    app.sftpBarItem.startSpinner();
    try {
      await handlerOption.handle.call(handleCtx, invokeOption);
    } catch (error) {
      // Annotate the error with the operation + remote path so the single top-level reporter can
      // turn a bare SFTP "Failure" into something diagnosable. We only tag and rethrow here — the
      // actual reporting still happens once, at the command boundary.
      if (error && typeof error === 'object' && !(error as any).ctx) {
        // Name the server too — with profiles one command hits several hosts, so "→ 1.2.3.4" turns a
        // bare "Permission denied" into something that says WHICH server rejected it.
        const host = handleCtx.config && handleCtx.config.host;
        (error as any).ctx = `${handlerOption.name}${host ? ` → ${host}` : ''} ${target.remoteFsPath}`;
      }
      throw error;
    } finally {
      app.sftpBarItem.stopSpinner();
    }
    if (handlerOption.afterHandle) {
      await handlerOption.afterHandle.call(handleCtx);
    }
  }

  return fileHandle;
}
