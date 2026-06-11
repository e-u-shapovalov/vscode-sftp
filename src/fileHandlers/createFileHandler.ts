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
  const config = fileService.getConfig();
  const target = UResource.from(uri, {
    localBasePath: fileService.baseDir,
    remoteBasePath: config.remotePath,
    remoteId: fileService.id,
    remote: {
      host: config.host,
      port: config.port,
    },
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

  const configArr = fileService.getAllConfig();

  return configArr.map(config => {
    const target = UResource.from(uri, {
      localBasePath: fileService.baseDir,
      remoteBasePath: config.remotePath,
      remoteId: fileService.id,
      remote: {
        host: config.host,
        port: config.port,
      },
    });

    return {
      fileService,
      config,
      target,
    };
  })
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
        (error as any).ctx = `${handlerOption.name} ${target.remoteFsPath}`;
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
