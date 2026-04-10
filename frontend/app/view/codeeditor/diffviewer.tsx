// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MonacoDiffViewer } from "@/app/monaco/monaco-react";
import { useOverrideConfigAtom } from "@/app/store/global";
import { boundNumber } from "@/util/util";
import type * as MonacoTypes from "monaco-editor";
import { useMemo, useRef } from "react";

interface DiffViewerProps {
    blockId: string;
    original: string;
    modified: string;
    language?: string;
    fileName: string;
    inlineDiff?: boolean;
    minimapEnabled?: boolean;
}

function defaultDiffEditorOptions(): MonacoTypes.editor.IDiffEditorOptions {
    const opts: MonacoTypes.editor.IDiffEditorOptions = {
        scrollBeyondLastLine: false,
        fontSize: 12,
        fontFamily: '"DMMono Nerd Font", "1984 Body", monospace',
        smoothScrolling: true,
        scrollbar: {
            useShadows: false,
            verticalScrollbarSize: 5,
            horizontalScrollbarSize: 5,
        },
        minimap: {
            enabled: true,
        },
        readOnly: true,
        renderSideBySide: true,
        originalEditable: false,
    };
    return opts;
}

export function DiffViewer({
    blockId,
    original,
    modified,
    language,
    fileName,
    inlineDiff: inlineDiffOverride,
    minimapEnabled: minimapEnabledOverride,
}: DiffViewerProps) {
    const minimapEnabled = useOverrideConfigAtom(blockId, "editor:minimapenabled") ?? false;
    const fontSize = boundNumber(useOverrideConfigAtom(blockId, "editor:fontsize"), 6, 64);
    const fontFamily = useOverrideConfigAtom(blockId, "editor:fontfamily") ?? "DMMono Nerd Font";
    const inlineDiffSetting = useOverrideConfigAtom(blockId, "editor:inlinediff");
    const uuidRef = useRef(crypto.randomUUID()).current;
    let editorPath: string;
    if (fileName) {
        const separator = fileName.startsWith("/") ? "" : "/";
        editorPath = blockId + separator + fileName;
    } else {
        editorPath = uuidRef;
    }

    const editorOpts = useMemo(() => {
        const opts = defaultDiffEditorOptions();
        opts.minimap.enabled = minimapEnabledOverride ?? minimapEnabled;
        opts.fontSize = fontSize;
        opts.fontFamily = `"${fontFamily.replace(/"/g, '\\"')}", "1984 Body", monospace`;
        const resolvedInlineDiff = inlineDiffOverride ?? inlineDiffSetting;
        if (resolvedInlineDiff != null) {
            opts.renderSideBySide = !resolvedInlineDiff;
        }
        return opts;
    }, [minimapEnabled, minimapEnabledOverride, fontSize, fontFamily, inlineDiffOverride, inlineDiffSetting]);

    return (
        <div className="flex flex-col w-full h-full overflow-hidden items-center justify-center">
            <div className="flex flex-col h-full w-full">
                <MonacoDiffViewer
                    path={editorPath}
                    original={original}
                    modified={modified}
                    options={editorOpts}
                    language={language}
                />
            </div>
        </div>
    );
}
