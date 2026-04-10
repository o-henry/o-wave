// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import Git2Svg from "@/app/asset/git2.svg";
import { globalStore } from "@/app/store/jotaiStore";
import { GitService } from "@/app/store/services";
import type { TabModel } from "@/app/store/tab-model";
import { DiffViewer } from "@/app/view/codeeditor/diffviewer";
import type { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import clsx from "clsx";
import * as jotai from "jotai";
import React, { useEffect, useMemo, useRef } from "react";
import "./codereview.scss";

type CodeReviewEnv = WaveEnvSubset<{
    wos: WaveEnv["wos"];
}>;

function inferLanguage(filePath: string): string | undefined {
    const normalized = filePath.toLowerCase();
    if (normalized.endsWith(".cs")) return "csharp";
    if (normalized.endsWith(".csproj") || normalized.endsWith(".props") || normalized.endsWith(".targets")) return "xml";
    if (normalized.endsWith(".json") || normalized.endsWith(".asmdef")) return "json";
    if (normalized.endsWith(".shader") || normalized.endsWith(".compute") || normalized.endsWith(".hlsl") || normalized.endsWith(".cginc")) return "cpp";
    if (normalized.endsWith(".yml") || normalized.endsWith(".yaml")) return "yaml";
    if (normalized.endsWith(".uxml") || normalized.endsWith(".xml")) return "xml";
    if (normalized.endsWith(".uss") || normalized.endsWith(".css")) return "css";
    if (normalized.endsWith(".sh")) return "shell";
    if (normalized.endsWith(".md")) return "markdown";
    return undefined;
}

function displayPath(file: CodeReviewFile): string {
    if (file.previouspath) {
        return `${file.previouspath} -> ${file.path}`;
    }
    return file.path;
}

function statusLabel(status: string): string {
    switch (status) {
        case "untracked":
            return "new";
        case "modified":
            return "modified";
        case "deleted":
            return "deleted";
        case "renamed":
            return "renamed";
        case "conflicted":
            return "conflict";
        default:
            return status;
    }
}

export class CodeReviewViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    env: CodeReviewEnv;
    viewType = "codereview";
    blockAtom: jotai.Atom<Block>;
    reviewAtom: jotai.PrimitiveAtom<CodeReviewData | null>;
    errorAtom: jotai.PrimitiveAtom<string | null>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    refreshVersionAtom: jotai.PrimitiveAtom<number>;
    selectedPathAtom: jotai.PrimitiveAtom<string | null>;
    expandedPathsAtom: jotai.PrimitiveAtom<string[]>;
    viewIcon: jotai.Atom<string | IconButtonDecl>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<string>;
    manageConnection: jotai.Atom<boolean>;
    noPadding: jotai.Atom<boolean>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv as CodeReviewEnv;
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.reviewAtom = jotai.atom(null) as jotai.PrimitiveAtom<CodeReviewData | null>;
        this.errorAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.loadingAtom = jotai.atom(true);
        this.refreshVersionAtom = jotai.atom(0);
        this.selectedPathAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.expandedPathsAtom = jotai.atom([]) as jotai.PrimitiveAtom<string[]>;
        this.viewIcon = jotai.atom({
            elemtype: "iconbutton",
            icon: (
                <span className="flex h-4 w-4 items-center justify-center [&_svg]:h-[14px] [&_svg]:w-[14px]">
                    <Git2Svg />
                </span>
            ),
            iconColor: "#ffffff",
            noAction: true,
            title: "Code Review",
        });
        this.viewName = jotai.atom("CODE REVIEW");
        this.viewText = jotai.atom((get) => {
            const review = get(this.reviewAtom);
            if (!review) {
                return "UNCOMMITTED CHANGES";
            }
            return `${review.branch.toUpperCase()} · ${review.filecount} FILES`;
        });
        this.manageConnection = jotai.atom(false);
        this.noPadding = jotai.atom(true);
        this.endIconButtons = jotai.atom([
            {
                elemtype: "iconbutton",
                icon: "arrows-rotate",
                title: "Refresh Review",
                click: () => globalStore.set(this.refreshVersionAtom, (value) => value + 1),
            },
        ]);
    }

    get viewComponent(): ViewComponent {
        return CodeReviewView;
    }
}

function CodeReviewView({ blockId, model }: ViewComponentProps<CodeReviewViewModel>) {
    const blockData = jotai.useAtomValue(model.blockAtom);
    const review = jotai.useAtomValue(model.reviewAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);
    const refreshVersion = jotai.useAtomValue(model.refreshVersionAtom);
    const [selectedPath, setSelectedPath] = jotai.useAtom(model.selectedPathAtom);
    const [expandedPaths, setExpandedPaths] = jotai.useAtom(model.expandedPathsAtom);
    const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

    useEffect(() => {
        async function loadReview() {
            globalStore.set(model.loadingAtom, true);
            globalStore.set(model.errorAtom, null);
            try {
                const path = blockData?.meta?.file;
                const result = await GitService.GetCodeReview(path);
                globalStore.set(model.reviewAtom, result);
                const filePaths = result.files.map((file) => file.path);
                globalStore.set(model.selectedPathAtom, filePaths[0] ?? null);
                globalStore.set(model.expandedPathsAtom, filePaths.slice(0, Math.min(3, filePaths.length)));
            } catch (e) {
                globalStore.set(model.errorAtom, `${e}`);
                globalStore.set(model.reviewAtom, null);
            } finally {
                globalStore.set(model.loadingAtom, false);
            }
        }

        void loadReview();
    }, [blockData?.meta?.file, refreshVersion]);

    useEffect(() => {
        if (!selectedPath) {
            return;
        }
        const target = cardRefs.current[selectedPath];
        target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [selectedPath]);

    const files = review?.files ?? [];
    const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);

    const toggleExpanded = (path: string) => {
        setExpandedPaths((prev) => {
            if (prev.includes(path)) {
                return prev.filter((value) => value !== path);
            }
            return [...prev, path];
        });
    };

    const handleSelectFile = (path: string) => {
        setSelectedPath(path);
        setExpandedPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    };

    if (loading) {
        return <div className="code-review-view"><div className="code-review-empty">Loading review…</div></div>;
    }

    if (error) {
        return <div className="code-review-view"><div className="code-review-empty">{error}</div></div>;
    }

    if (!review || files.length === 0) {
        return <div className="code-review-view"><div className="code-review-empty">No open changes in this repository.</div></div>;
    }

    return (
        <div className="code-review-view">
            <div className="code-review-toolbar">
                <div className="code-review-toolbar-copy">
                    <div className="code-review-toolbar-title">
                        Reviewing open changes <strong>{review.filecount}</strong>
                    </div>
                    <div className="code-review-toolbar-stats">
                        <span className="code-review-accent-branch">{review.branch}</span>
                        <span className="code-review-accent-add">+{review.added}</span>
                        <span className="code-review-accent-remove">-{review.removed}</span>
                    </div>
                </div>
                <div className="code-review-toolbar-pill">{review.changescope}</div>
            </div>
            <div className="code-review-shell">
                <div className="code-review-sidebar">
                    {files.map((file) => (
                        <button
                            key={file.path}
                            type="button"
                            className={clsx("code-review-sidebar-row", { "is-active": selectedPath === file.path })}
                            onClick={() => handleSelectFile(file.path)}
                        >
                            <span className="code-review-sidebar-path">{displayPath(file)}</span>
                            <span className="code-review-sidebar-meta">
                                <span className="code-review-accent-add">{file.added > 0 ? `+${file.added}` : ""}</span>
                                <span className="code-review-accent-remove">{file.removed > 0 ? `-${file.removed}` : ""}</span>
                            </span>
                        </button>
                    ))}
                </div>
                <div className="code-review-main">
                    {files.map((file) => {
                        const expanded = expandedSet.has(file.path);
                        return (
                            <div
                                key={file.path}
                                className="code-review-card"
                                ref={(node) => {
                                    cardRefs.current[file.path] = node;
                                }}
                            >
                                <button
                                    type="button"
                                    className="code-review-card-header"
                                    onClick={() => {
                                        setSelectedPath(file.path);
                                        toggleExpanded(file.path);
                                    }}
                                >
                                    <i className={expanded ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-right"} />
                                    <div className="code-review-card-title">{displayPath(file)}</div>
                                    <div className="code-review-card-status">
                                        <span className="code-review-status-pill">{statusLabel(file.status)}</span>
                                        <span className="code-review-accent-add">{file.added > 0 ? `+${file.added}` : "0"}</span>
                                        <span className="code-review-accent-remove">{file.removed > 0 ? `-${file.removed}` : "0"}</span>
                                    </div>
                                </button>
                                {expanded && (
                                    <div className="code-review-card-body">
                                        {file.binary || file.toolarge ? (
                                            <div className="code-review-binary">
                                                {file.binary ? "Binary file - no diff available" : "File too large - no diff available"}
                                            </div>
                                        ) : (
                                            <DiffViewer
                                                blockId={blockId}
                                                original={file.original ?? ""}
                                                modified={file.modified ?? ""}
                                                fileName={file.path}
                                                language={inferLanguage(file.path)}
                                                inlineDiff={true}
                                                minimapEnabled={false}
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
