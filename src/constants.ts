import * as path from 'path';

const VENDOR_FOLDER = '.vscode';

export const EXTENSION_NAME = 'wireferry';
export const EXTENSION_DISPLAY_NAME = 'WireFerry';
export const SETTING_KEY_REMOTE = 'remotefs.remote';

export const REMOTE_SCHEME = 'remote';

export const CONGIF_FILENAME = 'wireferry.json';
// Projects set up before the rename used .vscode/sftp.json; keep it as a read-only fallback.
export const LEGACY_CONFIG_FILENAME = 'sftp.json';
export const CONFIG_PATH = path.join(VENDOR_FOLDER, CONGIF_FILENAME);
export const LEGACY_CONFIG_PATH = path.join(VENDOR_FOLDER, LEGACY_CONFIG_FILENAME);

// command not in package.json
export const COMMAND_TOGGLE_OUTPUT = 'wireferry.toggleOutput';

// commands in package.json
export const COMMAND_CONFIG = 'wireferry.config';
export const COMMAND_SET_PROFILE = 'wireferry.setProfile';
export const COMMAND_CANCEL_ALL_TRANSFER = 'wireferry.cancelAllTransfer';
export const COMMAND_OPEN_CONNECTION_IN_TERMINAL = 'wireferry.openConnectInTerminal';
export const COMMAND_OPEN_EXTENSION_PAGE = 'wireferry.openExtensionPage';

export const COMMAND_FORCE_UPLOAD = 'wireferry.forceUpload';
export const COMMAND_UPLOAD = 'wireferry.upload';
export const COMMAND_UPLOAD_FILE = 'wireferry.upload.file';
export const COMMAND_UPLOAD_CHANGEDFILES = 'wireferry.upload.changedFiles';
export const COMMAND_UPLOAD_ACTIVEFILE = 'wireferry.upload.activeFile';
export const COMMAND_UPLOAD_FOLDER = 'wireferry.upload.folder';
export const COMMAND_UPLOAD_ACTIVEFOLDER = 'wireferry.upload.activeFolder';
export const COMMAND_UPLOAD_PROJECT = 'wireferry.upload.project';

export const COMMAND_FORCE_UPLOAD_TO_ALL_PROFILES = 'wireferry.forceUpload.to.allProfiles';
export const COMMAND_UPLOAD_TO_ALL_PROFILES = 'wireferry.upload.to.allProfiles';
export const COMMAND_UPLOAD_FILE_TO_ALL_PROFILES = 'wireferry.upload.file.to.allProfiles';
export const COMMAND_UPLOAD_ACTIVEFILE_TO_ALL_PROFILES = 'wireferry.upload.activeFile.to.allProfiles';
export const COMMAND_UPLOAD_FOLDER_TO_ALL_PROFILES = 'wireferry.upload.folder.to.allProfiles';
export const COMMAND_UPLOAD_ACTIVEFOLDER_TO_ALL_PROFILES = 'wireferry.upload.activeFolder.to.allProfiles';
export const COMMAND_UPLOAD_PROJECT_TO_ALL_PROFILES = 'wireferry.upload.project.to.allProfiles';

export const COMMAND_FORCE_DOWNLOAD = 'wireferry.forceDownload';
export const COMMAND_DOWNLOAD = 'wireferry.download';
export const COMMAND_DOWNLOAD_FILE = 'wireferry.download.file';
export const COMMAND_DOWNLOAD_ACTIVEFILE = 'wireferry.download.activeFile';
export const COMMAND_DOWNLOAD_FOLDER = 'wireferry.download.folder';
export const COMMAND_DOWNLOAD_ACTIVEFOLDER = 'wireferry.download.activeFolder';
export const COMMAND_DOWNLOAD_PROJECT = 'wireferry.download.project';

export const COMMAND_SYNC_LOCAL_TO_REMOTE = 'wireferry.sync.localToRemote';
export const COMMAND_SYNC_REMOTE_TO_LOCAL = 'wireferry.sync.remoteToLocal';
export const COMMAND_SYNC_BOTH_DIRECTIONS = 'wireferry.sync.bothDirections';

export const COMMAND_DIFF = 'wireferry.diff';
export const COMMAND_DIFF_ACTIVEFILE = 'wireferry.diff.activeFile';
export const COMMAND_LIST = 'wireferry.list';
export const COMMAND_LIST_ACTIVEFOLDER = 'wireferry.listActiveFolder';
export const COMMAND_LIST_ALL = 'wireferry.listAll';
export const COMMAND_DELETE_REMOTE = 'wireferry.delete.remote';
export const COMMAND_REVEAL_IN_EXPLORER = 'wireferry.revealInExplorer';
export const COMMAND_REVEAL_IN_REMOTE_EXPLORER = 'wireferry.revealInRemoteExplorer';

export const COMMAND_REMOTEEXPLORER_REFRESH = 'wireferry.remoteExplorer.refresh';
export const COMMAND_REMOTEEXPLORER_REFRESH_ACTIVE_FILE = "wireferry.remoteExplorer.refreshActiveFile"
export const COMMAND_REMOTEEXPLORER_EDITINLOCAL = 'wireferry.remoteExplorer.editInLocal';
export const COMMAND_REMOTEEXPLORER_VIEW_CONTENT = 'wireferry.viewContent';
export const COMMAND_REMOTEEXPLORER_COPY_PATH = 'wireferry.remoteExplorer.copyPath';
export const COMMAND_REMOTEEXPLORER_OPEN_BY_PATH = 'wireferry.remoteExplorer.openByPath';

export const COMMAND_CREATE_FOLDER = 'wireferry.create.folder';
export const COMMAND_CREATE_FILE = 'wireferry.create.file';
export const COMMAND_RENAME = 'wireferry.rename';
