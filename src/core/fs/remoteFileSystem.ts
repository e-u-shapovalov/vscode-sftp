import FileSystem, { FileOption } from './fileSystem';
import { RemoteClient, ConnectOption, RemoteClientConfig } from '../remote-client';

interface RFSOptionDefaults {
  remoteTimeOffsetInHours: number;
}

type RFSOption = Partial<RFSOptionDefaults> & {
  client?: RemoteClient;
  clientOption?: ConnectOption;
};

const SECONDS_PER_HOUR = 60 * 60;
const MILLISECONDS_PER_HOUR = SECONDS_PER_HOUR * 1000;

const defaultOption: RFSOptionDefaults = {
  remoteTimeOffsetInHours: 0,
};

export default abstract class RemoteFileSystem extends FileSystem {
  protected client: RemoteClient;
  private _remoteTimeOffsetInMilliseconds: number = 0;
  private _remoteTimeOffsetInSeconds: number = 0;

  constructor(pathResolver, option: RFSOption) {
    super(pathResolver);

    const _option = {
      ...defaultOption,
      ...option,
    };
    const { client, clientOption, remoteTimeOffsetInHours } = _option;
    if (client) {
      this.client = client;
    } else if (clientOption) {
      this.client = this._createClient(clientOption);
    } else {
      throw new Error('No client or clientOption is provided');
    }

    this.setRemoteTimeOffsetInHours(remoteTimeOffsetInHours);
  }

  setRemoteTimeOffsetInHours(offset: number) {
    this._remoteTimeOffsetInSeconds = offset * SECONDS_PER_HOUR;
    this._remoteTimeOffsetInMilliseconds = offset * MILLISECONDS_PER_HOUR;
  }

  getClient() {
    if (!this.client) {
      throw new Error('client not found!');
    }
    return this.client;
  }

  connect(connectOpetion: ConnectOption, config: RemoteClientConfig): Promise<void> {
    return this.client.connect(
      connectOpetion,
      config
    );
  }

  onDisconnected(cb) {
    this.client.onDisconnected(cb);
  }

  end() {
    this.client.end();
  }

  toLocalTime(remoteTimeMilliseconds: number): number {
    return remoteTimeMilliseconds - this._remoteTimeOffsetInMilliseconds;
  }

  toRemoteTimeInSecnonds(localtime: number): number {
    return localtime + this._remoteTimeOffsetInSeconds;
  }

  async readFile(path: string, option?: FileOption): Promise<string | Buffer> {
    return new Promise<string | Buffer>(async (resolve, reject) => {
      let stream;
      try {
        stream = await this.get(path, option);
      } catch (error) {
        return reject(error);
      }

      const arr: Buffer[] = [];
      let settled = false;
      const onData = chunk => {
        arr.push(chunk);
      };
      const cleanup = () => {
        stream.removeListener('data', onData);
        stream.removeListener('error', onError);
        stream.removeListener('end', onEnd);
        stream.removeListener('close', onClose);
      };
      const onError = err => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(err);
      };
      const onEnd = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        const buffer = Buffer.concat(arr);
        resolve(option && option.encoding ? buffer.toString(option.encoding as BufferEncoding) : buffer);
      };
      // A stream destroyed mid-read (transferTask.cancel → abortReadableStream calls .destroy())
      // emits 'close' WITHOUT 'end'; without this the promise would hang forever — e.g. a remote-file
      // preview opened while a download is being cancelled never resolves. On success 'close' fires
      // after 'end', but the `settled` guard makes the late event a no-op.
      const onClose = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error('stream closed before end'));
      };

      stream.on('data', onData);
      stream.on('error', onError);
      stream.on('end', onEnd);
      stream.on('close', onClose);
    });
  }

  protected abstract _createClient(option: ConnectOption): any;
}
