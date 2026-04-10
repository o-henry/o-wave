// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MonacoCodeEditor } from "@/app/monaco/monaco-react";
import { useOverrideConfigAtom } from "@/app/store/global";
import { boundNumber } from "@/util/util";
import type * as MonacoTypes from "monaco-editor";
import * as MonacoModule from "monaco-editor";
import { initVimMode } from "monaco-vim";
import React, { useMemo, useRef } from "react";

function defaultEditorOptions(): MonacoTypes.editor.IEditorOptions {
    const opts: MonacoTypes.editor.IEditorOptions = {
        scrollBeyondLastLine: false,
        fontSize: 12,
        fontFamily: '"DMMono Nerd Font", "1984 Body", monospace',
        cursorStyle: "underline-thin",
        cursorBlinking: "solid",
        smoothScrolling: true,
        scrollbar: {
            useShadows: false,
            verticalScrollbarSize: 5,
            horizontalScrollbarSize: 5,
        },
        minimap: {
            enabled: true,
        },
        stickyScroll: {
            enabled: false,
        },
    };
    return opts;
}

interface CodeEditorProps {
    blockId: string;
    text: string;
    readonly: boolean;
    enableVim?: boolean;
    language?: string;
    fileName?: string;
    onChange?: (text: string) => void;
    onMount?: (monacoPtr: MonacoTypes.editor.IStandaloneCodeEditor, monaco: typeof MonacoModule) => () => void;
}

export function CodeEditor({ blockId, text, language, fileName, readonly, enableVim, onChange, onMount }: CodeEditorProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const vimStatusRef = useRef<HTMLDivElement>(null);
    const unmountRef = useRef<() => void>(null);
    const minimapEnabled = useOverrideConfigAtom(blockId, "editor:minimapenabled") ?? false;
    const stickyScrollEnabled = useOverrideConfigAtom(blockId, "editor:stickyscrollenabled") ?? false;
    const wordWrap = useOverrideConfigAtom(blockId, "editor:wordwrap") ?? false;
    const fontSize = boundNumber(useOverrideConfigAtom(blockId, "editor:fontsize"), 6, 64);
    const fontFamily = useOverrideConfigAtom(blockId, "editor:fontfamily") ?? "DMMono Nerd Font";
    const uuidRef = useRef(crypto.randomUUID()).current;
    let editorPath: string;
    if (fileName) {
        const separator = fileName.startsWith("/") ? "" : "/";
        editorPath = blockId + separator + fileName;
    } else {
        editorPath = uuidRef;
    }

    React.useEffect(() => {
        return () => {
            // unmount function
            if (unmountRef.current) {
                unmountRef.current();
            }
        };
    }, []);

    function handleEditorChange(text: string) {
        if (onChange) {
            onChange(text);
        }
    }

    function handleEditorOnMount(
        editor: MonacoTypes.editor.IStandaloneCodeEditor,
        monaco: typeof MonacoModule
    ): () => void {
        const cleanupFns: Array<() => void> = [];
        if (onMount) {
            const cleanup = onMount(editor, monaco);
            if (cleanup) {
                cleanupFns.push(cleanup);
            }
        }
        if (enableVim && !readonly && vimStatusRef.current) {
            const vimMode = initVimMode(editor, vimStatusRef.current);
            cleanupFns.push(() => vimMode.dispose());
        }
        const combinedCleanup = () => {
            cleanupFns.forEach((cleanup) => cleanup());
        };
        unmountRef.current = combinedCleanup;
        return combinedCleanup;
    }

    const editorOpts = useMemo(() => {
        const opts = defaultEditorOptions();
        opts.minimap.enabled = minimapEnabled;
        opts.stickyScroll.enabled = stickyScrollEnabled;
        opts.wordWrap = wordWrap ? "on" : "off";
        opts.fontSize = fontSize;
        opts.fontFamily = `"${fontFamily.replace(/"/g, '\\"')}", "1984 Body", monospace`;
        opts.copyWithSyntaxHighlighting = false;
        return opts;
    }, [minimapEnabled, stickyScrollEnabled, wordWrap, fontSize, fontFamily, readonly]);

    return (
        <div className="flex flex-col w-full h-full items-center justify-center">
            <div className="flex flex-col h-full w-full" ref={divRef}>
                <MonacoCodeEditor
                    readonly={readonly}
                    text={text}
                    options={editorOpts}
                    onChange={handleEditorChange}
                    onMount={handleEditorOnMount}
                    path={editorPath}
                    language={language}
                />
                {enableVim && !readonly && (
                    <div
                        ref={vimStatusRef}
                        className='min-h-6 shrink-0 border-t border-border px-3 py-1 text-[11px] text-secondary [font-family:"Departure_Mono","DM_Mono_Nerd_Font",monospace] uppercase'
                    />
                )}
            </div>
        </div>
    );
}
