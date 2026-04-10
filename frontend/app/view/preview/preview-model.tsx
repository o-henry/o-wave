// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import Git2Svg from "@/app/asset/git2.svg";
import SidebarCircleSvg from "@/app/asset/sidebar-circle.svg";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { createBlockSplitVertically, getOverrideConfigAtom, refocusNode, replaceBlock } from "@/store/global";
import * as WOS from "@/store/wos";
import { goHistory, goHistoryBack, goHistoryForward } from "@/util/historyutil";
import { checkKeyPressed } from "@/util/keyutil";
import { addOpenMenuItems } from "@/util/previewutil";
import { base64ToString, fireAndForget, isBlank, isLocalConnName, jotaiLoadableValue, stringToBase64 } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import clsx from "clsx";
import { Atom, atom, Getter, PrimitiveAtom, WritableAtom } from "jotai";
import { loadable } from "jotai/utils";
import type * as MonacoTypes from "monaco-editor";
import { createRef } from "react";
import { PreviewView } from "./preview";
import { makeDirectoryDefaultMenuItems } from "./preview-directory-utils";
import type { PreviewEnv } from "./previewenv";

// TODO drive this using config
const BOOKMARKS: { label: string; path: string }[] = [
    { label: "Home", path: "~" },
    { label: "Desktop", path: "~/Desktop" },
    { label: "Downloads", path: "~/Downloads" },
    { label: "Documents", path: "~/Documents" },
    { label: "Root", path: "/" },
];

const MaxFileSize = 1024 * 1024 * 10; // 10MB
const MaxCSVSize = 1024 * 1024 * 1; // 1MB
const PreviewTaskBlockIdKey = "preview:taskblockid";
const PreviewReviewBlockIdKey = "preview:reviewblockid";
const DefaultUnityBuildCommand =
    `SLN="$(find . -maxdepth 1 -name '*.sln' | head -n 1)"; if [ -n "$SLN" ]; then dotnet build "$SLN"; else dotnet build; fi`;
const DefaultUnityRunCommand = "open -a Unity .";
const DefaultDotnetBuildCommand = "dotnet build";
const DefaultDotnetRunCommand = "dotnet run";

const textApplicationMimetypes = [
    "application/sql",
    "application/x-php",
    "application/x-pem-file",
    "application/x-httpd-php",
    "application/liquid",
    "application/graphql",
    "application/javascript",
    "application/typescript",
    "application/x-javascript",
    "application/x-typescript",
    "application/dart",
    "application/vnd.dart",
    "application/x-ruby",
    "application/sql",
    "application/wasm",
    "application/x-latex",
    "application/x-sh",
    "application/x-python",
    "application/x-awk",
];

function isTextFile(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("text/") ||
        textApplicationMimetypes.includes(mimeType) ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml"))) ||
        mimeType.includes("xml")
    );
}

function isStreamingType(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("application/pdf") ||
        mimeType.startsWith("video/") ||
        mimeType.startsWith("audio/") ||
        mimeType.startsWith("image/")
    );
}

function isMarkdownLike(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return mimeType.startsWith("text/markdown") || mimeType.startsWith("text/mdx");
}

function iconForFile(mimeType: string): string {
    if (mimeType == null) {
        mimeType = "unknown";
    }
    if (mimeType == "application/pdf") {
        return "file-pdf";
    } else if (mimeType.startsWith("image/")) {
        return "image";
    } else if (mimeType.startsWith("video/")) {
        return "film";
    } else if (mimeType.startsWith("audio/")) {
        return "headphones";
    } else if (isMarkdownLike(mimeType)) {
        return "file-lines";
    } else if (mimeType == "text/csv") {
        return "file-csv";
    } else if (
        mimeType.startsWith("text/") ||
        mimeType == "application/sql" ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml")))
    ) {
        return "file-code";
    } else {
        return "file";
    }
}

function normalizePath(filePath: string): string {
    return (filePath ?? "").replace(/\\/g, "/");
}

function getParentDir(filePath: string): string {
    const normalized = normalizePath(filePath).replace(/\/+$/, "");
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) {
        return idx === 0 ? "/" : normalized;
    }
    return normalized.slice(0, idx);
}

function getUnityProjectRoot(filePath: string): string | null {
    const normalized = normalizePath(filePath);
    for (const marker of ["/Assets/", "/Packages/", "/ProjectSettings/"]) {
        const idx = normalized.indexOf(marker);
        if (idx > 0) {
            return normalized.slice(0, idx);
        }
    }
    return null;
}

function isUnityProjectPath(filePath: string): boolean {
    return getUnityProjectRoot(filePath) != null;
}

function isBuildableCodePath(filePath: string): boolean {
    const normalized = normalizePath(filePath).toLowerCase();
    return (
        isUnityProjectPath(normalized) ||
        normalized.endsWith(".cs") ||
        normalized.endsWith(".csproj") ||
        normalized.endsWith(".sln") ||
        normalized.endsWith(".shader") ||
        normalized.endsWith(".compute") ||
        normalized.endsWith(".hlsl") ||
        normalized.endsWith(".cginc") ||
        normalized.endsWith(".asmdef") ||
        normalized.endsWith(".uxml") ||
        normalized.endsWith(".uss")
    );
}

export class PreviewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    noPadding?: Atom<boolean>;
    blockAtom: Atom<Block>;
    viewIcon: Atom<string | IconButtonDecl>;
    viewName: Atom<string>;
    viewText: Atom<HeaderElem[]>;
    preIconButton: Atom<IconButtonDecl>;
    endIconButtons: Atom<IconButtonDecl[]>;
    hideViewName: Atom<boolean>;
    previewTextRef: React.RefObject<HTMLDivElement>;
    editMode: Atom<boolean>;
    canPreview: PrimitiveAtom<boolean>;
    specializedView: Atom<Promise<{ specializedView?: string; errorStr?: string }>>;
    loadableSpecializedView: Atom<Loadable<{ specializedView?: string; errorStr?: string }>>;
    manageConnection: Atom<boolean>;
    connStatus: Atom<ConnStatus>;
    filterOutNowsh?: Atom<boolean>;

    metaFilePath: Atom<string>;
    statFilePath: Atom<Promise<string>>;
    loadableFileInfo: Atom<Loadable<FileInfo>>;
    connection: Atom<Promise<string>>;
    connectionImmediate: Atom<string>;
    statFile: Atom<Promise<FileInfo>>;
    fullFile: Atom<Promise<FileData>>;
    fileMimeType: Atom<Promise<string>>;
    fileMimeTypeLoadable: Atom<Loadable<string>>;
    fileContentSaved: PrimitiveAtom<string | null>;
    fileContent: WritableAtom<Promise<string>, [string], void>;
    newFileContent: PrimitiveAtom<string | null>;
    connectionError: PrimitiveAtom<string>;
    errorMsgAtom: PrimitiveAtom<ErrorMsg>;

    openFileModal: PrimitiveAtom<boolean>;
    openFileModalDelay: PrimitiveAtom<boolean>;
    openFileError: PrimitiveAtom<string>;
    openFileModalGiveFocusRef: React.RefObject<() => boolean>;

    markdownShowToc: PrimitiveAtom<boolean>;

    monacoRef: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor>;

    showHiddenFiles: PrimitiveAtom<boolean>;
    refreshVersion: PrimitiveAtom<number>;
    directorySearchActive: PrimitiveAtom<boolean>;
    refreshCallback: () => void;
    directoryKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;
    codeEditKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;
    env: PreviewEnv;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.viewType = "preview";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv;
        this.showHiddenFiles = atom<boolean>(false);
        this.refreshVersion = atom(0);
        this.directorySearchActive = atom(false);
        this.previewTextRef = createRef();
        this.openFileModal = atom(false);
        this.openFileModalDelay = atom(false);
        this.openFileError = atom(null) as PrimitiveAtom<string>;
        this.openFileModalGiveFocusRef = createRef();
        this.manageConnection = atom(true);
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.markdownShowToc = atom(false);
        this.filterOutNowsh = atom(true);
        this.monacoRef = createRef();
        this.connectionError = atom("");
        this.errorMsgAtom = atom(null) as PrimitiveAtom<ErrorMsg | null>;
        this.viewIcon = atom((get) => {
            const blockData = get(this.blockAtom);
            if (blockData?.meta?.icon) {
                return blockData.meta.icon;
            }
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeTypeLoadable = get(this.fileMimeTypeLoadable);
            const mimeType = jotaiLoadableValue(mimeTypeLoadable, "");
            if (mimeType == "directory") {
                return null;
            }
            return iconForFile(mimeType);
        });
        this.editMode = atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.edit ?? false;
        });
        this.viewName = atom("Preview");
        this.hideViewName = atom(true);
        this.viewText = atom((get) => {
            let headerPath = get(this.metaFilePath);
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return [
                    {
                        elemtype: "text",
                        text: headerPath,
                        className: "preview-filename",
                    },
                ];
            }
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            const loadableFileInfo = get(this.loadableFileInfo);
            if (loadableFileInfo.state == "hasData") {
                headerPath = loadableFileInfo.data?.path;
                if (headerPath == "~") {
                    headerPath = `~ (${loadableFileInfo.data?.dir + "/" + loadableFileInfo.data?.name})`;
                }
            }
            if (!isBlank(headerPath) && headerPath != "/" && headerPath.endsWith("/")) {
                headerPath = headerPath.slice(0, -1);
            }
            const viewTextChildren: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: headerPath,
                    ref: this.previewTextRef,
                    className: "preview-filename",
                    onClick: () => this.toggleOpenFileModal(),
                },
            ];
            if (isCeView) {
                const fileInfo = globalStore.get(this.loadableFileInfo);
                if (fileInfo.state != "hasData") {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: "Loading ...",
                        className: clsx(`grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => {},
                    });
                } else if (fileInfo.data.readonly) {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: "Read Only",
                        className: clsx(`yellow rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => {},
                    });
                }
            }
            return [
                {
                    elemtype: "div",
                    children: viewTextChildren,
                },
            ] as HeaderElem[];
        });
        this.preIconButton = atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const metaPath = get(this.metaFilePath);
            if (mimeType == "directory" && metaPath == "/") {
                return null;
            }
            return {
                elemtype: "iconbutton",
                icon: "chevron-left",
                click: this.goParentDirectory.bind(this),
            };
        });
        this.endIconButtons = atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const fileInfo = jotaiLoadableValue(get(this.loadableFileInfo), null);
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            const hasUnsavedChanges = isCeView && get(this.newFileContent) !== null;
            const canRunTasks = isCeView && fileInfo?.path != null && isBuildableCodePath(fileInfo.path);
            const connection = get(this.connectionImmediate);
            const canOpenReview = isCeView && fileInfo?.path != null && isLocalConnName(connection);
            if (mimeType == "directory") {
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "arrows-rotate",
                        className: "preview-directory-toolbar-button preview-refresh-button",
                        click: () => this.refreshCallback?.(),
                    },
                ] as IconButtonDecl[];
            } else if (!isCeView && isMarkdownLike(mimeType)) {
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "arrows-rotate",
                        className: "preview-refresh-button",
                        title: "Refresh",
                        click: () => this.refreshCallback?.(),
                    },
                ] as IconButtonDecl[];
            } else if (!isCeView && mimeType) {
                // For all other file types (text, code, etc.), add refresh button
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "arrows-rotate",
                        className: "preview-refresh-button",
                        title: "Refresh",
                        click: () => this.refreshCallback?.(),
                    },
                ] as IconButtonDecl[];
            } else if (isCeView) {
                const buttons: IconButtonDecl[] = [];
                if (hasUnsavedChanges) {
                    buttons.push({
                        elemtype: "iconbutton",
                        icon: (
                            <span className="flex h-4 w-4 items-center justify-center">
                                <SidebarCircleSvg />
                            </span>
                        ),
                        title: "Unsaved Changes",
                        iconColor: "#22c55e",
                        className: "preview-unsaved-indicator",
                        noAction: true,
                    });
                }
                if (canRunTasks) {
                    buttons.push(
                        {
                            elemtype: "iconbutton",
                            icon: "hammer",
                            title: "Build Project",
                            click: () => fireAndForget(() => this.runProjectTask("build")),
                        },
                        {
                            elemtype: "iconbutton",
                            icon: "play",
                            title: "Run Project",
                            click: () => fireAndForget(() => this.runProjectTask("run")),
                        }
                    );
                }
                if (canOpenReview) {
                    buttons.push({
                        elemtype: "iconbutton",
                        icon: (
                            <span className="flex h-4 w-4 items-center justify-center [&_svg]:h-[14px] [&_svg]:w-[14px]">
                                <Git2Svg />
                            </span>
                        ),
                        title: "Open Code Review",
                        iconColor: "#ffffff",
                        click: () => fireAndForget(() => this.openCodeReviewPanel()),
                    });
                }
                return buttons.length > 0 ? buttons : null;
            }
            return null;
        });
        this.metaFilePath = atom<string>((get) => {
            const file = get(this.blockAtom)?.meta?.file;
            if (isBlank(file)) {
                return "~";
            }
            return file;
        });
        this.statFilePath = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.path;
        });
        this.connection = atom<Promise<string>>(async (get) => {
            const connName = get(this.blockAtom)?.meta?.connection;
            try {
                await this.env.rpc.ConnEnsureCommand(TabRpcClient, { connname: connName }, { timeout: 60000 });
                globalStore.set(this.connectionError, "");
            } catch (e) {
                globalStore.set(this.connectionError, e as string);
            }
            return connName;
        });
        this.connectionImmediate = atom<string>((get) => {
            return get(this.blockAtom)?.meta?.connection;
        });
        this.statFile = atom<Promise<FileInfo>>(async (get) => {
            const fileName = get(this.metaFilePath);
            const path = await this.formatRemoteUri(fileName, get);
            if (fileName == null) {
                return null;
            }
            try {
                const statFile = await this.env.rpc.FileInfoCommand(TabRpcClient, {
                    info: {
                        path,
                    },
                });
                return statFile;
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: "File Read Failed",
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
            }
        });
        this.fileMimeType = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.mimetype;
        });
        this.fileMimeTypeLoadable = loadable(this.fileMimeType);
        this.newFileContent = atom(null) as PrimitiveAtom<string | null>;
        this.goParentDirectory = this.goParentDirectory.bind(this);

        const fullFileAtom = atom<Promise<FileData>>(async (get) => {
            get(this.refreshVersion); // Subscribe to refreshVersion to trigger re-fetch
            const fileName = get(this.metaFilePath);
            const path = await this.formatRemoteUri(fileName, get);
            if (fileName == null) {
                return null;
            }
            try {
                const file = await this.env.rpc.FileReadCommand(TabRpcClient, {
                    info: {
                        path,
                    },
                });
                return file;
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: "File Read Failed",
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
            }
        });

        this.fileContentSaved = atom(null) as PrimitiveAtom<string | null>;
        const fileContentAtom = atom(
            async (get) => {
                const newContent = get(this.newFileContent);
                if (newContent != null) {
                    return newContent;
                }
                const savedContent = get(this.fileContentSaved);
                if (savedContent != null) {
                    return savedContent;
                }
                const fullFile = await get(fullFileAtom);
                return base64ToString(fullFile?.data64);
            },
            (_, set, update: string) => {
                set(this.fileContentSaved, update);
            }
        );

        this.fullFile = fullFileAtom;
        this.fileContent = fileContentAtom;

        this.specializedView = atom<Promise<{ specializedView?: string; errorStr?: string }>>(async (get) => {
            return this.getSpecializedView(get);
        });
        this.loadableSpecializedView = loadable(this.specializedView);
        this.canPreview = atom(false);
        this.loadableFileInfo = loadable(this.statFile);
        this.connStatus = atom((get) => {
            const blockData = get(this.blockAtom);
            const connName = blockData?.meta?.connection;
            const connAtom = this.env.getConnStatusAtom(connName);
            return get(connAtom);
        });

        this.noPadding = atom(true);
    }

    markdownShowTocToggle() {
        globalStore.set(this.markdownShowToc, !globalStore.get(this.markdownShowToc));
    }

    get viewComponent(): ViewComponent {
        return PreviewView;
    }

    async getSpecializedView(getFn: Getter): Promise<{ specializedView?: string; errorStr?: string }> {
        const mimeType = await getFn(this.fileMimeType);
        const fileInfo = await getFn(this.statFile);
        const fileName = fileInfo?.name;
        const connErr = getFn(this.connectionError);
        const editMode = getFn(this.editMode);
        const genErr = getFn(this.errorMsgAtom);

        if (!fileInfo) {
            return { errorStr: `Load Error: ${genErr?.text}` };
        }
        if (connErr != "") {
            return { errorStr: `Connection Error: ${connErr}` };
        }
        if (fileInfo?.notfound) {
            return { specializedView: "codeedit" };
        }
        if (mimeType == null) {
            return { errorStr: `Unable to determine mimetype for: ${fileInfo.path}` };
        }
        if (isStreamingType(mimeType)) {
            return { specializedView: "streaming" };
        }
        if (!fileInfo) {
            const fileNameStr = fileName ? " " + JSON.stringify(fileName) : "";
            return { errorStr: "File Not Found" + fileNameStr };
        }
        if (fileInfo.size > MaxFileSize) {
            return { errorStr: "File Too Large to Preview (10 MB Max)" };
        }
        if (mimeType == "text/csv" && fileInfo.size > MaxCSVSize) {
            return { errorStr: "CSV File Too Large to Preview (1 MB Max)" };
        }
        if (mimeType == "directory") {
            return { specializedView: "directory" };
        }
        if (mimeType == "text/csv") {
            if (editMode) {
                return { specializedView: "codeedit" };
            }
            return { specializedView: "csv" };
        }
        if (isMarkdownLike(mimeType)) {
            if (editMode) {
                return { specializedView: "codeedit" };
            }
            return { specializedView: "markdown" };
        }
        if (isTextFile(mimeType) || fileInfo.size == 0) {
            return { specializedView: "codeedit" };
        }
        return { errorStr: `Preview (${mimeType})` };
    }

    updateOpenFileModalAndError(isOpen, errorMsg = null) {
        globalStore.set(this.openFileModal, isOpen);
        globalStore.set(this.openFileError, errorMsg);
        if (isOpen) {
            globalStore.set(this.openFileModalDelay, true);
        } else {
            const delayVal = globalStore.get(this.openFileModalDelay);
            if (delayVal) {
                setTimeout(() => {
                    globalStore.set(this.openFileModalDelay, false);
                }, 200);
            }
        }
    }

    toggleOpenFileModal() {
        const modalOpen = globalStore.get(this.openFileModal);
        const delayVal = globalStore.get(this.openFileModalDelay);
        if (!modalOpen && delayVal) {
            return;
        }
        this.updateOpenFileModalAndError(!modalOpen);
    }

    async goHistory(newPath: string) {
        let fileName = globalStore.get(this.metaFilePath);
        if (fileName == null) {
            fileName = "";
        }
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const updateMeta = goHistory("file", fileName, newPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);

        // Clear the saved file buffers
        globalStore.set(this.fileContentSaved, null);
        globalStore.set(this.newFileContent, null);
    }

    async goParentDirectory({ fileInfo = null }: { fileInfo?: FileInfo | null }) {
        // optional parameter needed for recursive case
        const defaultFileInfo = await globalStore.get(this.statFile);
        if (fileInfo === null) {
            fileInfo = defaultFileInfo;
        }
        if (fileInfo == null) {
            this.updateOpenFileModalAndError(false);
            return true;
        }
        try {
            this.updateOpenFileModalAndError(false);
            await this.goHistory(fileInfo.dir);
            refocusNode(this.blockId);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", fileInfo.dir, e);
        }
    }

    async goHistoryBack() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = goHistoryBack("file", curPath, blockMeta, true);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);
    }

    async goHistoryForward() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = goHistoryForward("file", curPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);
    }

    async setEditMode(edit: boolean) {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, { ...blockMeta, edit });
    }

    async handleFileSave({ skipAutoBuild = false }: { skipAutoBuild?: boolean } = {}) {
        const filePath = globalStore.get(this.metaFilePath) ?? (await globalStore.get(this.statFilePath));
        if (filePath == null) {
            return;
        }
        const newFileContent = globalStore.get(this.newFileContent);
        if (newFileContent == null) {
            console.log("not saving file, newFileContent is null");
            return;
        }
        try {
            await this.env.rpc.FileWriteCommand(TabRpcClient, {
                info: {
                    path: await this.formatRemoteUri(filePath, globalStore.get),
                },
                data64: stringToBase64(newFileContent),
            });
            globalStore.set(this.fileContent, newFileContent);
            globalStore.set(this.newFileContent, null);
            console.log("saved file", filePath);
            const autoBuildOnSave = globalStore.get(this.env.getSettingsKeyAtom("preview:autobuildonsave")) ?? false;
            if (!skipAutoBuild && autoBuildOnSave && isBuildableCodePath(filePath)) {
                await this.runProjectTask("build", { triggeredByAutoSave: true });
            }
        } catch (e) {
            const errorStatus: ErrorMsg = {
                status: "Save Failed",
                text: `${e}`,
            };
            globalStore.set(this.errorMsgAtom, errorStatus);
        }
    }

    async handleFileRevert() {
        const fileContent = await globalStore.get(this.fileContent);
        this.monacoRef.current?.setValue(fileContent);
        globalStore.set(this.newFileContent, null);
    }

    async handleOpenFile(filePath: string) {
        const fileInfo = await globalStore.get(this.statFile);
        this.updateOpenFileModalAndError(false);
        if (fileInfo == null) {
            return true;
        }
        try {
            this.goHistory(filePath);
            refocusNode(this.blockId);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", filePath, e);
        }
    }

    private getTaskExecutionContext(filePath: string): { cwd: string } {
        const unityRoot = getUnityProjectRoot(filePath);
        if (unityRoot != null) {
            return { cwd: unityRoot };
        }
        return { cwd: getParentDir(filePath) };
    }

    private getTaskCommand(taskType: "build" | "run", filePath: string): string {
        const settingsKey = taskType === "build" ? "preview:buildcommand" : "preview:runcommand";
        const configured = (globalStore.get(this.env.getSettingsKeyAtom(settingsKey)) ?? "").trim();
        if (configured !== "") {
            return configured;
        }
        const unityProject = isUnityProjectPath(filePath);
        if (taskType === "build") {
            return unityProject ? DefaultUnityBuildCommand : DefaultDotnetBuildCommand;
        }
        return unityProject ? DefaultUnityRunCommand : DefaultDotnetRunCommand;
    }

    private makeTaskBlockDef(taskType: "build" | "run", command: string, cwd: string): BlockDef {
        const connection = globalStore.get(this.connectionImmediate);
        const meta: MetaType = {
            view: "term",
            controller: "cmd",
            cmd: command,
            "cmd:cwd": cwd,
            "cmd:shell": true,
            "cmd:runonce": true,
            "cmd:clearonstart": true,
            "cmd:closeonexit": false,
            "frame:title": taskType === "build" ? "Build Output" : "Run Output",
            icon: taskType === "build" ? "hammer" : "play",
        };
        if (connection) {
            meta.connection = connection;
        }
        return { meta };
    }

    async runProjectTask(taskType: "build" | "run", options: { triggeredByAutoSave?: boolean } = {}) {
        const filePath = await globalStore.get(this.statFilePath);
        if (filePath == null) {
            return;
        }
        if (!options.triggeredByAutoSave && globalStore.get(this.newFileContent) != null) {
            await this.handleFileSave({ skipAutoBuild: true });
        }
        const { cwd } = this.getTaskExecutionContext(filePath);
        const command = this.getTaskCommand(taskType, filePath);
        const blockDef = this.makeTaskBlockDef(taskType, command, cwd);
        const blockMeta = globalStore.get(this.blockAtom)?.meta ?? {};
        const existingTaskBlockId = (blockMeta as Record<string, any>)[PreviewTaskBlockIdKey] as string | undefined;
        try {
            if (existingTaskBlockId) {
                const nextBlockId = await replaceBlock(existingTaskBlockId, blockDef, false);
                await this.env.services.object.UpdateObjectMeta(WOS.makeORef("block", this.blockId), {
                    [PreviewTaskBlockIdKey]: nextBlockId,
                } as MetaType);
                return;
            }
        } catch (e) {
            console.warn("unable to reuse preview task block", e);
        }
        const newBlockId = await createBlockSplitVertically(blockDef, this.blockId, "after");
        await this.env.services.object.UpdateObjectMeta(WOS.makeORef("block", this.blockId), {
            [PreviewTaskBlockIdKey]: newBlockId,
        } as MetaType);
        refocusNode(this.blockId);
    }

    async openCodeReviewPanel() {
        const filePath = globalStore.get(this.metaFilePath) ?? (await globalStore.get(this.statFilePath));
        if (filePath == null) {
            return;
        }
        const connection = globalStore.get(this.connectionImmediate);
        if (!isLocalConnName(connection)) {
            return;
        }
        const blockDef: BlockDef = {
            meta: {
                view: "codereview",
                file: filePath,
            },
        };
        const blockMeta = globalStore.get(this.blockAtom)?.meta ?? {};
        const existingReviewBlockId = (blockMeta as Record<string, any>)[PreviewReviewBlockIdKey] as string | undefined;
        try {
            if (existingReviewBlockId) {
                const nextBlockId = await replaceBlock(existingReviewBlockId, blockDef, false);
                await this.env.services.object.UpdateObjectMeta(WOS.makeORef("block", this.blockId), {
                    [PreviewReviewBlockIdKey]: nextBlockId,
                } as MetaType);
                return;
            }
        } catch (e) {
            console.warn("unable to reuse preview review block", e);
        }
        const newBlockId = await createBlockSplitVertically(blockDef, this.blockId, "after");
        await this.env.services.object.UpdateObjectMeta(WOS.makeORef("block", this.blockId), {
            [PreviewReviewBlockIdKey]: newBlockId,
        } as MetaType);
        refocusNode(this.blockId);
    }

    isSpecializedView(sv: string): boolean {
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        return loadableSV.state == "hasData" && loadableSV.data.specializedView == sv;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const defaultFontSize = globalStore.get(this.env.getSettingsKeyAtom("editor:fontsize")) ?? 12;
        const blockData = globalStore.get(this.blockAtom);
        const overrideFontSize = blockData?.meta?.["editor:fontsize"];
        const menuItems: ContextMenuItem[] = [];
        menuItems.push({
            label: "Copy Full Path",
            click: () =>
                fireAndForget(async () => {
                    const filePath = await globalStore.get(this.statFilePath);
                    if (filePath == null) {
                        return;
                    }
                    const conn = await globalStore.get(this.connection);
                    if (conn) {
                        // remote path
                        await navigator.clipboard.writeText(formatRemoteUri(filePath, conn));
                    } else {
                        // local path
                        await navigator.clipboard.writeText(filePath);
                    }
                }),
        });
        menuItems.push({
            label: "Copy File Name",
            click: () =>
                fireAndForget(async () => {
                    const fileInfo = await globalStore.get(this.statFile);
                    if (fileInfo == null || fileInfo.name == null) {
                        return;
                    }
                    await navigator.clipboard.writeText(fileInfo.name);
                }),
        });
        menuItems.push({ type: "separator" });
        const finfo = jotaiLoadableValue(globalStore.get(this.loadableFileInfo), null);
        addOpenMenuItems(menuItems, globalStore.get(this.connectionImmediate), finfo);
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        const wordWrapAtom = getOverrideConfigAtom(this.blockId, "editor:wordwrap");
        const wordWrap = globalStore.get(wordWrapAtom) ?? false;
        menuItems.push({ type: "separator" });
        if (loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit") {
            const fontSizeSubMenu: ContextMenuItem[] = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(
                (fontSize: number) => {
                    return {
                        label: fontSize.toString() + "px",
                        type: "checkbox",
                        checked: overrideFontSize == fontSize,
                        click: () => {
                            this.env.rpc.SetMetaCommand(TabRpcClient, {
                                oref: WOS.makeORef("block", this.blockId),
                                meta: { "editor:fontsize": fontSize },
                            });
                        },
                    };
                }
            );
            fontSizeSubMenu.unshift({
                label: "Default (" + defaultFontSize + "px)",
                type: "checkbox",
                checked: overrideFontSize == null,
                click: () => {
                    this.env.rpc.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "editor:fontsize": null },
                    });
                },
            });
            menuItems.push({
                label: "Editor Font Size",
                submenu: fontSizeSubMenu,
            });
            if (globalStore.get(this.newFileContent) != null) {
                menuItems.push({ type: "separator" });
                menuItems.push({
                    label: "Save File",
                    click: () => fireAndForget(this.handleFileSave.bind(this)),
                });
                menuItems.push({
                    label: "Revert File",
                    click: () => fireAndForget(this.handleFileRevert.bind(this)),
                });
            }
            const fileInfo = jotaiLoadableValue(globalStore.get(this.loadableFileInfo), null);
            if (fileInfo?.path && isBuildableCodePath(fileInfo.path)) {
                menuItems.push({ type: "separator" });
                menuItems.push({
                    label: "Build Project",
                    click: () => fireAndForget(() => this.runProjectTask("build")),
                });
                menuItems.push({
                    label: "Run Project",
                    click: () => fireAndForget(() => this.runProjectTask("run")),
                });
            }
            if (fileInfo?.path && isLocalConnName(globalStore.get(this.connectionImmediate))) {
                menuItems.push({
                    label: "Open Code Review",
                    click: () => fireAndForget(() => this.openCodeReviewPanel()),
                });
            }
            menuItems.push({ type: "separator" });
            menuItems.push({
                label: "Word Wrap",
                type: "checkbox",
                checked: wordWrap,
                click: () =>
                    fireAndForget(async () => {
                        const blockOref = WOS.makeORef("block", this.blockId);
                        await this.env.services.object.UpdateObjectMeta(blockOref, {
                            "editor:wordwrap": !wordWrap,
                        });
                    }),
            });
        }
        if (loadableSV.state == "hasData" && loadableSV.data.specializedView == "directory") {
            menuItems.push({ type: "separator" });
            menuItems.push({ label: "Default Settings", enabled: false });
            menuItems.push(...makeDirectoryDefaultMenuItems(this));
        }
        return menuItems;
    }

    giveFocus(): boolean {
        const openModalOpen = globalStore.get(this.openFileModal);
        if (openModalOpen) {
            this.openFileModalGiveFocusRef.current?.();
            return true;
        }
        if (this.monacoRef.current) {
            this.monacoRef.current.focus();
            return true;
        }
        return false;
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(e, "Cmd:ArrowLeft")) {
            fireAndForget(this.goHistoryBack.bind(this));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowRight")) {
            fireAndForget(this.goHistoryForward.bind(this));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowUp")) {
            // handle up directory
            fireAndForget(() => this.goParentDirectory({}));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:o")) {
            this.toggleOpenFileModal();
            return true;
        }
        const canPreview = globalStore.get(this.canPreview);
        if (canPreview) {
            if (checkKeyPressed(e, "Cmd:e")) {
                const editMode = globalStore.get(this.editMode);
                fireAndForget(() => this.setEditMode(!editMode));
                return true;
            }
        }
        if (this.directoryKeyDownHandler) {
            const handled = this.directoryKeyDownHandler(e);
            if (handled) {
                return true;
            }
        }
        if (this.codeEditKeyDownHandler) {
            const handled = this.codeEditKeyDownHandler(e);
            if (handled) {
                return true;
            }
        }
        return false;
    }

    async formatRemoteUri(path: string, get: Getter): Promise<string> {
        return formatRemoteUri(path, await get(this.connection));
    }
}
