// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { WorkspaceSwitcher } from "@/app/tab/workspaceswitcher";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { modalsModel } from "@/store/modalmodel";
import * as keyutil from "@/util/keyutil";
import { fireAndForget, isBlank, makeIconClass } from "@/util/util";
import {
    autoUpdate,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { type ChangeEvent, memo, useCallback, useEffect, useRef, useState } from "react";

export type WidgetsEnv = WaveEnvSubset<{
    isDev: WaveEnv["isDev"];
    isWindows: WaveEnv["isWindows"];
    electron: {
        openBuilder: WaveEnv["electron"]["openBuilder"];
    };
    rpc: {
        ListAllAppsCommand: WaveEnv["rpc"]["ListAllAppsCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        hasConfigErrors: WaveEnv["atoms"]["hasConfigErrors"];
        workspaceId: WaveEnv["atoms"]["workspaceId"];
        hasCustomAIPresetsAtom: WaveEnv["atoms"]["hasCustomAIPresetsAtom"];
    };
    createBlock: WaveEnv["createBlock"];
    showContextMenu: WaveEnv["showContextMenu"];
}>;

function sortByDisplayOrder(wmap: { [key: string]: WidgetConfigType }): WidgetConfigType[] {
    if (wmap == null) {
        return [];
    }
    const wlist = Object.values(wmap);
    wlist.sort((a, b) => {
        return (a["display:order"] ?? 0) - (b["display:order"] ?? 0);
    });
    return wlist;
}

type WidgetPropsType = {
    widget: WidgetConfigType;
    mode: "normal" | "compact" | "supercompact";
    env: WidgetsEnv;
    shortcutLabel?: string;
};

async function handleWidgetSelect(widget: WidgetConfigType, env: WidgetsEnv) {
    const blockDef = widget.blockdef;
    env.createBlock(blockDef, widget.magnified);
}

const Widget = memo(({ widget, mode, env, shortcutLabel }: WidgetPropsType) => {
    const [isTruncated, setIsTruncated] = useState(false);
    const labelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (mode === "normal" && labelRef.current) {
            const element = labelRef.current;
            setIsTruncated(element.scrollWidth > element.clientWidth);
        }
    }, [mode, widget.label]);

    const shouldDisableTooltip = mode !== "normal" ? false : !isTruncated;

    return (
        <Tooltip
            content={widget.description || widget.label}
            placement="left"
            disable={shouldDisableTooltip}
            divClassName={clsx(
                "flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary overflow-hidden hover:bg-hoverbg hover:text-white cursor-pointer",
                mode === "supercompact" ? "text-sm" : "text-lg",
                widget["display:hidden"] && "hidden"
            )}
            divOnClick={() => handleWidgetSelect(widget, env)}
        >
            <div style={{ color: widget.color }}>
                <i className={makeIconClass(widget.icon, true, { defaultIcon: "browser" })}></i>
            </div>
            {mode === "normal" && !isBlank(widget.label) ? (
                <div
                    ref={labelRef}
                    className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis"
                >
                    {shortcutLabel ?? widget.label}
                </div>
            ) : null}
        </Tooltip>
    );
});

function calculateGridSize(appCount: number): number {
    if (appCount <= 4) return 2;
    if (appCount <= 9) return 3;
    if (appCount <= 16) return 4;
    if (appCount <= 25) return 5;
    return 6;
}

function getWidgetShortcutLabel(index: number): string {
    return `CMD+OPT+${index + 4}`;
}

function getWidgetShortcutMatcher(event: WaveKeyboardEvent, index: number): boolean {
    const shortcutNumber = index + 4;
    if (shortcutNumber > 9) {
        return false;
    }
    return keyutil.checkKeyPressed(event, `Cmd:Option:c{Digit${shortcutNumber}}`);
}

function getShortcutItems(widgets: WidgetConfigType[], featureWaveAppBuilder: boolean): { label: string; shortcut: string }[] {
    const quickItems = [
        { label: "Terminal", shortcut: "CMD+OPT+1" },
        { label: "Files", shortcut: "CMD+OPT+2" },
        { label: "Web", shortcut: "CMD+OPT+3" },
    ];
    const widgetItems = widgets.slice(0, 9).map((widget, index) => ({
        label: widget.label || widget.description || `Widget ${index + 1}`,
        shortcut: getWidgetShortcutLabel(index),
    }));
    const extraItems = [
        ...(featureWaveAppBuilder ? [{ label: "Local WaveApps", shortcut: "CMD+OPT+A" }] : []),
        { label: "Settings", shortcut: "CMD+," },
        { label: "Workspace Sidebar", shortcut: "CMD+\\" },
    ];
    return [...quickItems, ...widgetItems, ...extraItems];
}

function getTipsShortcutItems(): { label: string; shortcut: string; note?: string }[] {
    return [
        { label: "Magnify a Block", shortcut: "CMD+M" },
        { label: "Connect to a remote server", shortcut: "CMD+G" },
        { label: "Block Settings", shortcut: "HEADER MENU" },
        { label: "Close Block", shortcut: "CMD+W" },
        { label: "New Tab", shortcut: "CMD+T" },
        { label: "New Terminal Block", shortcut: "CMD+N" },
        { label: "Open Wave AI Panel", shortcut: "CMD+SHIFT+A" },
        { label: "Switch To Nth Tab", shortcut: "CMD+1..9" },
        { label: "Previous Tab", shortcut: "CMD+[" },
        { label: "Next Tab", shortcut: "CMD+]" },
        { label: "Navigate Between Blocks", shortcut: "CTRL+SHIFT+ARROWS" },
        { label: "Focus Nth Block", shortcut: "CTRL+SHIFT+1..9" },
        { label: "Focus Wave AI", shortcut: "CTRL+SHIFT+0" },
        { label: "Split Right", shortcut: "CMD+D" },
        { label: "Split Below", shortcut: "CMD+SHIFT+D" },
        { label: "Split in Direction", shortcut: "CTRL+SHIFT+S + ARROWS" },
        { label: "wsh view", shortcut: "COMMAND", note: "Preview files, directories, or web URLs" },
        { label: "wsh edit", shortcut: "COMMAND", note: "Edit config and code files" },
        { label: "Tabs", shortcut: "TIP", note: "Right click any tab to change backgrounds or rename" },
        { label: "Web View", shortcut: "TIP", note: "Use the gear in web view to set your homepage" },
        { label: "Terminal", shortcut: "TIP", note: "Use the gear in terminal to set theme and font size" },
    ];
}

function getConfigItems(isWindows: boolean): { name: string; file: string; description?: string }[] {
    return [
        { name: "GENERAL", file: "settings.json", description: "Global preferences" },
        { name: "CONNECTIONS", file: "connections.json", description: isWindows ? "SSH hosts and WSL distros" : "SSH hosts" },
        { name: "SIDEBAR WIDGETS", file: "widgets.json", description: "Customize command center shortcuts" },
        { name: "TAB BACKGROUNDS", file: "backgrounds.json", description: "Background presets" },
        { name: "SECRETS", file: "secrets", description: "Secure secret storage" },
    ];
}

function SettingsTooltipContent({ hasConfigErrors }: { hasConfigErrors: boolean }) {
    if (!hasConfigErrors) {
        return "Settings & Help";
    }
    return (
        <div className="flex flex-col p-1">
            <div className="mb-1">Settings &amp; Help</div>
            <div className="flex items-center gap-1 mt-0.5 text-error">
                <i className="fa fa-solid fa-circle-exclamation"></i>
                <span>Config Errors</span>
            </div>
        </div>
    );
}

type FloatingWindowPropsType = {
    isOpen: boolean;
    onClose: () => void;
    referenceElement: HTMLElement;
    hasConfigErrors?: boolean;
    shortcutItems?: { label: string; shortcut: string; note?: string }[];
    featureWaveAppBuilder?: boolean;
    onOpenApps?: () => void;
};

const AppsFloatingWindow = memo(({ isOpen, onClose, referenceElement }: FloatingWindowPropsType) => {
    const [apps, setApps] = useState<AppInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const env = useWaveEnv<WidgetsEnv>();

    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        onOpenChange: onClose,
        placement: "left-start",
        middleware: [offset(-2), shift({ padding: 12 })],
        whileElementsMounted: autoUpdate,
        elements: {
            reference: referenceElement,
        },
    });

    const dismiss = useDismiss(context);
    const { getFloatingProps } = useInteractions([dismiss]);
    const handleOpenBuilder = useCallback(() => {
        env.electron.openBuilder(null);
        onClose();
    }, [onClose, env]);

    useEffect(() => {
        if (!isOpen) return;

        const fetchApps = async () => {
            setLoading(true);
            try {
                const allApps = await env.rpc.ListAllAppsCommand(TabRpcClient);
                const localApps = allApps
                    .filter((app) => !app.appid.startsWith("draft/"))
                    .sort((a, b) => {
                        const aName = a.appid.replace(/^local\//, "");
                        const bName = b.appid.replace(/^local\//, "");
                        return aName.localeCompare(bName);
                    });
                setApps(localApps);
            } catch (error) {
                console.error("Failed to fetch apps:", error);
                setApps([]);
            } finally {
                setLoading(false);
            }
        };

        fetchApps();
    }, [isOpen]);

    if (!isOpen) return null;

    const gridSize = calculateGridSize(apps.length);

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                {...getFloatingProps()}
                className="bg-modalbg border border-border rounded-lg shadow-xl z-50 overflow-hidden"
            >
                <div className="p-4">
                    {loading ? (
                        <div className="flex items-center justify-center p-8">
                            <i className="fa fa-solid fa-spinner fa-spin text-2xl text-muted"></i>
                        </div>
                    ) : apps.length === 0 ? (
                        <div className="text-muted text-sm p-4 text-center">No local apps found</div>
                    ) : (
                        <div
                            className="grid gap-3"
                            style={{
                                gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                                maxWidth: `${gridSize * 80}px`,
                            }}
                        >
                            {apps.map((app) => {
                                const appMeta = app.manifest?.appmeta;
                                const displayName = app.appid.replace(/^local\//, "");
                                const icon = appMeta?.icon || "cube";
                                const iconColor = appMeta?.iconcolor || "white";

                                return (
                                    <div
                                        key={app.appid}
                                        className="flex flex-col items-center justify-center p-2 rounded hover:bg-hoverbg cursor-pointer transition-colors"
                                        onClick={() => {
                                            const blockDef: BlockDef = {
                                                meta: {
                                                    view: "tsunami",
                                                    controller: "tsunami",
                                                    "tsunami:appid": app.appid,
                                                },
                                            };
                                            env.createBlock(blockDef);
                                            onClose();
                                        }}
                                    >
                                        <div style={{ color: iconColor }} className="text-3xl mb-1">
                                            <i className={makeIconClass(icon, false)}></i>
                                        </div>
                                        <div className="text-xxs text-center text-secondary break-words w-full px-1">
                                            {displayName}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    className="w-full px-4 py-2 border-t border-border text-xs text-secondary text-center hover:bg-hoverbg hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-2"
                    onClick={handleOpenBuilder}
                >
                    <i className="fa fa-solid fa-hammer"></i>
                    Build/Edit Apps
                </button>
            </div>
        </FloatingPortal>
    );
});

const SettingsFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        hasConfigErrors,
        shortcutItems = [],
        featureWaveAppBuilder = false,
        onOpenApps,
    }: FloatingWindowPropsType) => {
        const env = useWaveEnv<WidgetsEnv>();
        const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
        const fileInputRef = useRef<HTMLInputElement>(null);
        const bgImagePath = fullConfig?.settings?.["window:bgimagepath"] ?? "";
        const bgImageOpacity = fullConfig?.settings?.["window:bgimageopacity"] ?? 0.22;
        const [bgOpacityInput, setBgOpacityInput] = useState(() => `${Math.round(bgImageOpacity * 100)}`);

        useEffect(() => {
            setBgOpacityInput(`${Math.round(bgImageOpacity * 100)}`);
        }, [bgImageOpacity]);

        const tipsShortcutItems = getTipsShortcutItems();
        const mergedShortcutItems = [...shortcutItems, ...tipsShortcutItems];
        const configItems = getConfigItems(env.isWindows?.() ?? false);

        const handleOpenBackgroundPicker = useCallback(() => {
            fileInputRef.current?.click();
        }, []);

        const commitBackgroundOpacity = useCallback(
            (rawValue: string) => {
                const parsedValue = Number(rawValue);
                const boundedValue = Number.isFinite(parsedValue) ? Math.min(Math.max(parsedValue, 0), 100) : 22;
                setBgOpacityInput(`${boundedValue}`);
                fireAndForget(() =>
                    env.rpc.SetConfigCommand(
                        TabRpcClient,
                        { "window:bgimageopacity": boundedValue / 100 } as SettingsType
                    )
                );
            },
            [env]
        );

        const handleBackgroundOpacityChange = useCallback(
            (event: ChangeEvent<HTMLInputElement>) => {
                setBgOpacityInput(event.target.value);
            },
            []
        );

        const handleBackgroundFileChange = useCallback(
            (event: ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];
                const nextPath = file ? window.api.getPathForFile(file) : "";
                if (!isBlank(nextPath)) {
                    fireAndForget(() =>
                        env.rpc.SetConfigCommand(TabRpcClient, { "window:bgimagepath": nextPath } as SettingsType)
                    );
                }
                event.target.value = "";
            },
            [env]
        );

        const handleClearBackgroundImage = useCallback(() => {
            fireAndForget(() =>
                env.rpc.SetConfigCommand(TabRpcClient, { "window:bgimagepath": null } as unknown as SettingsType)
            );
        }, [env]);

        if (!isOpen) return null;

        return (
            <FloatingPortal>
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 backdrop-blur-[2px]"
                    onClick={onClose}
                >
                    <div
                        className="w-[min(760px,calc(100vw-48px))] max-h-[min(88vh,760px)] overflow-hidden border border-white/14 bg-[#111214] text-[#e7e5e4] uppercase shadow-[0_22px_70px_rgba(0,0,0,0.55)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-end bg-[#161719] px-5 py-3">
                            <button
                                type="button"
                                className="flex h-5 w-5 items-center justify-center text-[#b7b2aa] hover:text-white"
                                onClick={onClose}
                                aria-label="Close command center"
                            >
                                <span
                                    aria-hidden="true"
                                    className="h-3.5 w-3.5"
                                    style={{
                                        backgroundColor: "currentColor",
                                        WebkitMaskImage: 'url("/xmark.svg")',
                                        maskImage: 'url("/xmark.svg")',
                                        WebkitMaskRepeat: "no-repeat",
                                        maskRepeat: "no-repeat",
                                        WebkitMaskPosition: "center",
                                        maskPosition: "center",
                                        WebkitMaskSize: "contain",
                                        maskSize: "contain",
                                    }}
                                />
                            </button>
                        </div>

                        <div
                            className="wave-command-center-scroll overflow-y-auto p-5"
                            style={{
                                maxHeight: "calc(min(88vh, 760px) - 49px)",
                                scrollbarWidth: "none",
                                msOverflowStyle: "none",
                            }}
                        >
                            <div>
                                <div className="mb-3 text-[10px] tracking-[0.16em] text-[#8e877f]">WORKSPACES</div>
                                <div className="bg-[#121315]">
                                    <WorkspaceSwitcher mode="content" />
                                </div>
                            </div>

                            {mergedShortcutItems.length > 0 && (
                                <div className="mt-5 py-4">
                                    <div className="mb-3 text-[10px] tracking-[0.16em] text-[#8e877f]">SHORTCUT MAP</div>
                                    <div className="space-y-0 border-t border-white/8">
                                        {mergedShortcutItems.map((item, index) => (
                                            <div
                                                key={`${item.label}:${item.shortcut}`}
                                                className="flex items-center gap-4 border-b border-white/8 py-2.5 text-[13px]"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[#d3cec7]">{item.label}</div>
                                                    {"note" in item && item.note ? (
                                                        <div className="mt-0.5 text-[11px] text-[#8e877f] uppercase">
                                                            {item.note}
                                                        </div>
                                                    ) : null}
                                                </div>
                                                <div
                                                    className={clsx(
                                                        "text-[11px] tracking-[0.14em]",
                                                        index % 3 === 0
                                                            ? "text-[#7ee787]"
                                                            : index % 3 === 1
                                                              ? "text-[#79c0ff]"
                                                              : "text-[#f2cc60]"
                                                    )}
                                                >
                                                    {item.shortcut}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="mt-5 py-4">
                                <div className="mb-3 text-[10px] tracking-[0.16em] text-[#8e877f]">WAVE CONFIG</div>
                                <div className="space-y-0 border-t border-white/8">
                                    {configItems.map((item) => (
                                        <button
                                            key={item.file}
                                            type="button"
                                            className="flex w-full items-center gap-4 border-b border-white/8 py-3 text-left transition-colors hover:bg-white/[0.03]"
                                            onClick={() => {
                                                const blockDef: BlockDef = {
                                                    meta: {
                                                        view: "waveconfig",
                                                        file: item.file,
                                                    },
                                                };
                                                env.createBlock(blockDef, false, true);
                                                onClose();
                                            }}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[13px] text-[#f2eee8]">{item.name}</div>
                                                {item.description ? (
                                                    <div className="mt-1 text-[11px] text-[#8e877f] uppercase">
                                                        {item.description}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className="text-[10px] tracking-[0.14em] text-[#79c0ff]">OPEN</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-5 py-4">
                                <div className="mb-3 text-[10px] tracking-[0.16em] text-[#8e877f]">WINDOW BACKGROUND</div>
                                <div className="border-t border-white/8">
                                    <div className="border-b border-white/8 px-0 py-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[13px] text-[#f2eee8]">BACKGROUND IMAGE</div>
                                                <div className="mt-1 truncate text-[11px] text-[#8e877f] uppercase">
                                                    {bgImagePath || "No image selected"}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {bgImagePath ? (
                                                    <button
                                                        type="button"
                                                        className="border border-white/10 px-3 py-1.5 text-[10px] tracking-[0.14em] text-[#f2cc60] transition-colors hover:bg-white/[0.03]"
                                                        onClick={handleClearBackgroundImage}
                                                    >
                                                        REMOVE
                                                    </button>
                                                ) : null}
                                                <button
                                                    type="button"
                                                    className="border border-white/10 px-3 py-1.5 text-[10px] tracking-[0.14em] text-[#79c0ff] transition-colors hover:bg-white/[0.03]"
                                                    onClick={handleOpenBackgroundPicker}
                                                >
                                                    UPLOAD
                                                </button>
                                            </div>
                                        </div>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleBackgroundFileChange}
                                        />
                                    </div>

                                    <div className="border-b border-white/8 px-0 py-3">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[13px] text-[#f2eee8]">BACKGROUND OPACITY</div>
                                                <div className="mt-1 text-[11px] text-[#8e877f] uppercase">
                                                    Enter 0 to 100
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="1"
                                                    value={bgOpacityInput}
                                                    className="wave-opacity-input w-[62px] border border-white/10 bg-[#151618] px-2 py-1.5 text-right text-[12px] text-[#f2eee8] outline-none transition-colors focus:border-[#79c0ff]"
                                                    onChange={handleBackgroundOpacityChange}
                                                    onBlur={(event) => commitBackgroundOpacity(event.target.value)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === "Enter") {
                                                            commitBackgroundOpacity((event.target as HTMLInputElement).value);
                                                        }
                                                    }}
                                                />
                                                <div className="text-[11px] tracking-[0.14em] text-[#79c0ff]">%</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <style>{`
                            .wave-command-center-scroll::-webkit-scrollbar {
                                display: none;
                            }

                            .wave-opacity-input {
                                appearance: textfield;
                                -moz-appearance: textfield;
                            }

                            .wave-opacity-input::-webkit-outer-spin-button,
                            .wave-opacity-input::-webkit-inner-spin-button {
                                -webkit-appearance: none;
                                margin: 0;
                            }
                        `}</style>
                    </div>
                </div>
            </FloatingPortal>
        );
    }
);

SettingsFloatingWindow.displayName = "SettingsFloatingWindow";

const Widgets = memo(() => {
    const env = useWaveEnv<WidgetsEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const hasConfigErrors = useAtomValue(env.atoms.hasConfigErrors);
    const workspaceId = useAtomValue(env.atoms.workspaceId);
    const featureWaveAppBuilder = fullConfig?.settings?.["feature:waveappbuilder"] ?? false;
    const widgetsMap = fullConfig?.widgets ?? {};
    const filteredWidgets = Object.fromEntries(
        Object.entries(widgetsMap).filter(([_key, widget]) => shouldIncludeWidgetForWorkspace(widget, workspaceId))
    );
    const widgets = sortByDisplayOrder(filteredWidgets);
    const shortcutItems = getShortcutItems(widgets, featureWaveAppBuilder);

    const [isAppsOpen, setIsAppsOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const floatingAnchorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const openSettings = () => setIsSettingsOpen(true);
        const handleShortcut = keyutil.keydownWrapper((event) => {
            if (keyutil.checkKeyPressed(event, "Cmd:,")) {
                setIsSettingsOpen(true);
                return true;
            }
            if (featureWaveAppBuilder && keyutil.checkKeyPressed(event, "Cmd:Option:a")) {
                setIsAppsOpen((current) => !current);
                return true;
            }
            const widgetIndex = widgets.slice(0, 9).findIndex((_widget, index) => getWidgetShortcutMatcher(event, index));
            if (widgetIndex !== -1) {
                handleWidgetSelect(widgets[widgetIndex], env);
                return true;
            }
            return false;
        });
        window.addEventListener("wave:open-settings-shortcuts", openSettings as EventListener);
        window.addEventListener("keydown", handleShortcut);
        return () => {
            window.removeEventListener("wave:open-settings-shortcuts", openSettings as EventListener);
            window.removeEventListener("keydown", handleShortcut);
        };
    }, [env, featureWaveAppBuilder, widgets]);

    return (
        <>
            <div
                ref={floatingAnchorRef}
                className="fixed top-4 right-4 w-px h-px pointer-events-none opacity-0"
                aria-hidden="true"
            />
            {(env.isDev() || featureWaveAppBuilder) && floatingAnchorRef.current && (
                <AppsFloatingWindow
                    isOpen={isAppsOpen}
                    onClose={() => setIsAppsOpen(false)}
                    referenceElement={floatingAnchorRef.current}
                />
            )}
            {floatingAnchorRef.current && (
                <SettingsFloatingWindow
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                    referenceElement={floatingAnchorRef.current}
                    hasConfigErrors={hasConfigErrors}
                    shortcutItems={shortcutItems}
                    featureWaveAppBuilder={featureWaveAppBuilder}
                    onOpenApps={() => setIsAppsOpen(true)}
                />
            )}
        </>
    );
});

export { Widgets };
