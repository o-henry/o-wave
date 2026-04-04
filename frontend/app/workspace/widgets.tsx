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
import { type ChangeEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
    return `CMD+OPT+${index + 6}`;
}

function getWidgetShortcutMatcher(event: WaveKeyboardEvent, index: number): boolean {
    const shortcutNumber = index + 6;
    if (shortcutNumber > 9) {
        return false;
    }
    return keyutil.checkKeyPressed(event, `Cmd:Option:c{Digit${shortcutNumber}}`);
}

const quickAccessItems: { label: string; shortcut: string; matcher: (event: WaveKeyboardEvent) => boolean; blockdef: BlockDef }[] = [
    {
        label: "Terminal",
        shortcut: "CMD+OPT+1",
        matcher: (event) => keyutil.checkKeyPressed(event, "Cmd:Option:c{Digit1}"),
        blockdef: { meta: { view: "term", controller: "shell" } },
    },
    {
        label: "Files",
        shortcut: "CMD+OPT+2",
        matcher: (event) => keyutil.checkKeyPressed(event, "Cmd:Option:c{Digit2}"),
        blockdef: { meta: { view: "preview", file: "~" } },
    },
    {
        label: "Web",
        shortcut: "CMD+OPT+3",
        matcher: (event) => keyutil.checkKeyPressed(event, "Cmd:Option:c{Digit3}"),
        blockdef: { meta: { view: "web" } },
    },
    {
        label: "CPU Usage",
        shortcut: "CMD+OPT+4",
        matcher: (event) => keyutil.checkKeyPressed(event, "Cmd:Option:c{Digit4}"),
        blockdef: { meta: { view: "sysinfo", "sysinfo:type": "CPU + Mem" } },
    },
    {
        label: "Processes",
        shortcut: "CMD+OPT+5",
        matcher: (event) => keyutil.checkKeyPressed(event, "Cmd:Option:c{Digit5}"),
        blockdef: { meta: { view: "processviewer" } },
    },
];

function isBuiltInQuickWidget(widget: WidgetConfigType): boolean {
    const meta = widget?.blockdef?.meta ?? {};
    if (meta.view === "term" && meta.controller === "shell") {
        return true;
    }
    if (meta.view === "preview") {
        return true;
    }
    if (meta.view === "web") {
        return true;
    }
    if (meta.view === "sysinfo") {
        return true;
    }
    if (meta.view === "processviewer") {
        return true;
    }
    return false;
}

function getShortcutItems(widgets: WidgetConfigType[], featureWaveAppBuilder: boolean): { label: string; shortcut: string }[] {
    const widgetItems = widgets
        .filter((widget) => !isBuiltInQuickWidget(widget))
        .slice(0, 4)
        .map((widget, index) => ({
        label: widget.label || widget.description || `Widget ${index + 1}`,
        shortcut: getWidgetShortcutLabel(index),
    }));
    const extraItems = [
        ...(featureWaveAppBuilder ? [{ label: "Local WaveApps", shortcut: "CMD+OPT+A" }] : []),
        { label: "Settings", shortcut: "CMD+," },
        { label: "Workspace Sidebar", shortcut: "CMD+\\" },
    ];
    return [
        ...quickAccessItems.map(({ label, shortcut }) => ({ label, shortcut })),
        ...widgetItems,
        ...extraItems,
    ];
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

const commonMonospaceFonts = [
    "DM Mono Nerd Font",
    "JetBrains Mono",
    "Menlo",
    "SF Mono",
    "Monaco",
    "Consolas",
    "Fira Code",
    "Cascadia Code",
    "Hack",
    "Iosevka",
];

type InstalledFontOption = {
    family: string;
    searchText: string;
};

const fontPreviewText = "AaBb 0OoIl1 [] {} => ~/src/main.ts";
let fontMeasureContext: CanvasRenderingContext2D | null = null;

function getFontMeasureContext(): CanvasRenderingContext2D | null {
    if (typeof document === "undefined") {
        return null;
    }
    if (fontMeasureContext) {
        return fontMeasureContext;
    }
    const canvas = document.createElement("canvas");
    fontMeasureContext = canvas.getContext("2d");
    return fontMeasureContext;
}

function makeFontPreviewFamily(fontName: string): string {
    const escapedFontName = fontName.replace(/"/g, '\\"');
    return `"${escapedFontName}", "DM Mono Nerd Font", monospace`;
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
        const termTheme = fullConfig?.settings?.["term:theme"] ?? "";
        const termFontSize = fullConfig?.settings?.["term:fontsize"];
        const termFontFamily = fullConfig?.settings?.["term:fontfamily"] ?? "";
        const termThemes = fullConfig?.termthemes ?? {};
        const [bgOpacityInput, setBgOpacityInput] = useState(() => `${Math.round(bgImageOpacity * 100)}`);
        const [fontSizeInput, setFontSizeInput] = useState(() => (termFontSize == null ? "" : `${termFontSize}`));
        const [fontFamilyInput, setFontFamilyInput] = useState(termFontFamily);
        const [fontBrowserOpen, setFontBrowserOpen] = useState(false);
        const [fontSearchInput, setFontSearchInput] = useState("");
        const [installedFontOptions, setInstalledFontOptions] = useState<InstalledFontOption[]>([]);
        const [fontsLoading, setFontsLoading] = useState(false);
        const [fontSourceState, setFontSourceState] = useState<"unknown" | "ready" | "unsupported" | "error">("unknown");

        useEffect(() => {
            setBgOpacityInput(`${Math.round(bgImageOpacity * 100)}`);
        }, [bgImageOpacity]);

        useEffect(() => {
            setFontSizeInput(termFontSize == null ? "" : `${termFontSize}`);
        }, [termFontSize]);

        useEffect(() => {
            setFontFamilyInput(termFontFamily);
        }, [termFontFamily]);

        useEffect(() => {
            if (!isOpen) {
                return;
            }
            let cancelled = false;
            const loadInstalledFonts = async () => {
                const queryLocalFonts = (
                    window as Window & {
                        queryLocalFonts?: () => Promise<
                            Array<{ family?: string; fullName?: string; postscriptName?: string }>
                        >;
                    }
                ).queryLocalFonts;
                if (typeof queryLocalFonts !== "function") {
                    if (!cancelled) {
                        setInstalledFontOptions([]);
                        setFontSourceState("unsupported");
                    }
                    return;
                }
                setFontsLoading(true);
                try {
                    const localFonts = await queryLocalFonts();
                    if (cancelled) {
                        return;
                    }
                    const fontMap = new Map<string, InstalledFontOption>();
                    localFonts.forEach((font) => {
                        const family = font.family?.trim();
                        if (isBlank(family)) {
                            return;
                        }
                        const searchParts = [family, font.fullName?.trim(), font.postscriptName?.trim()].filter(
                            (part): part is string => !isBlank(part)
                        );
                        const existing = fontMap.get(family);
                        if (existing) {
                            existing.searchText = `${existing.searchText} ${searchParts.join(" ")}`.toLowerCase();
                            return;
                        }
                        fontMap.set(family, {
                            family,
                            searchText: searchParts.join(" ").toLowerCase(),
                        });
                    });
                    const installedFonts = Array.from(fontMap.values()).sort((a, b) => a.family.localeCompare(b.family));
                    setInstalledFontOptions(installedFonts);
                    setFontSourceState("ready");
                } catch (error) {
                    if (cancelled) {
                        return;
                    }
                    console.error("Failed to query local fonts", error);
                    setInstalledFontOptions([]);
                    setFontSourceState("error");
                } finally {
                    if (!cancelled) {
                        setFontsLoading(false);
                    }
                }
            };
            loadInstalledFonts();
            return () => {
                cancelled = true;
            };
        }, [isOpen]);

        const tipsShortcutItems = getTipsShortcutItems();
        const mergedShortcutItems = [...shortcutItems, ...tipsShortcutItems];
        const sortedTermThemes = Object.entries(termThemes).sort(([, themeA], [, themeB]) => {
            return (themeA["display:order"] ?? 0) - (themeB["display:order"] ?? 0);
        });
        const visibleFontOptions = useMemo(() => {
            const searchQuery = fontSearchInput.trim().toLowerCase();
            const mergedFonts = new Map<string, { fontName: string; isInstalled: boolean; searchText: string }>();
            [termFontFamily, fontFamilyInput, ...commonMonospaceFonts]
                .filter((fontName): fontName is string => !isBlank(fontName))
                .forEach((fontName) => {
                    mergedFonts.set(fontName, {
                        fontName,
                        isInstalled: false,
                        searchText: fontName.toLowerCase(),
                    });
                });
            installedFontOptions.forEach((font) => {
                mergedFonts.set(font.family, {
                    fontName: font.family,
                    isInstalled: true,
                    searchText: font.searchText,
                });
            });
            return Array.from(mergedFonts.values())
                .filter((font) => (searchQuery === "" ? true : font.searchText.includes(searchQuery)))
                .sort((a, b) => {
                    if (a.isInstalled !== b.isInstalled) {
                        return a.isInstalled ? -1 : 1;
                    }
                    return a.fontName.localeCompare(b.fontName);
                })
                .map((font) => font.fontName);
        }, [fontFamilyInput, fontSearchInput, installedFontOptions, termFontFamily]);
        const handleOpenBackgroundPicker = useCallback(() => {
            fileInputRef.current?.click();
        }, []);

        const updateConfigValue = useCallback(
            (patch: Partial<SettingsType>) => {
                fireAndForget(() => env.rpc.SetConfigCommand(TabRpcClient, patch as SettingsType));
            },
            [env]
        );

        const commitBackgroundOpacity = useCallback(
            (rawValue: string) => {
                const parsedValue = Number(rawValue);
                const boundedValue = Number.isFinite(parsedValue) ? Math.min(Math.max(parsedValue, 0), 100) : 22;
                setBgOpacityInput(`${boundedValue}`);
                updateConfigValue({ "window:bgimageopacity": boundedValue / 100 });
            },
            [updateConfigValue]
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
                const nextPath = file ? ((window as Window & { api?: ElectronApi }).api?.getPathForFile(file) ?? "") : "";
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
            updateConfigValue({ "window:bgimagepath": null } as unknown as Partial<SettingsType>);
        }, [updateConfigValue]);

        const commitTermFontSize = useCallback(
            (rawValue: string) => {
                const trimmedValue = rawValue.trim();
                if (trimmedValue === "") {
                    setFontSizeInput("");
                    updateConfigValue({ "term:fontsize": null } as unknown as Partial<SettingsType>);
                    return;
                }
                const parsedValue = Number(trimmedValue);
                const boundedValue = Number.isFinite(parsedValue) ? Math.min(Math.max(Math.round(parsedValue), 6), 18) : 12;
                setFontSizeInput(`${boundedValue}`);
                updateConfigValue({ "term:fontsize": boundedValue });
            },
            [updateConfigValue]
        );

        const commitTermFontFamily = useCallback(
            (rawValue: string) => {
                const trimmedValue = rawValue.trim();
                setFontFamilyInput(trimmedValue);
                updateConfigValue({ "term:fontfamily": trimmedValue === "" ? null : trimmedValue } as Partial<SettingsType>);
            },
            [updateConfigValue]
        );

        const selectTerminalFont = useCallback(
            (fontName: string) => {
                setFontFamilyInput(fontName);
                setFontBrowserOpen(false);
                commitTermFontFamily(fontName);
            },
            [commitTermFontFamily]
        );

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
                                        WebkitMaskImage: 'url("xmark.svg")',
                                        maskImage: 'url("xmark.svg")',
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
                                <div className="mb-3 text-[10px] tracking-[0.16em] text-[#8e877f]">TERMINAL DEFAULTS</div>
                                <div className="border-t border-white/8">
                                    <div className="border-b border-white/8 px-0 py-3">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[13px] text-[#f2eee8]">TERMINAL THEME</div>
                                                <div className="mt-1 text-[11px] text-[#8e877f] uppercase">
                                                    Default for new and non-overridden terminals
                                                </div>
                                            </div>
                                            <select
                                                value={termTheme === "" ? "__default__" : termTheme}
                                                className="min-w-[180px] border-0 border-b border-white/20 bg-transparent px-0 py-1 text-right text-[12px] text-[#f2eee8] outline-none transition-colors focus:border-[#79c0ff]"
                                                onChange={(event) =>
                                                    updateConfigValue({
                                                        "term:theme":
                                                            event.target.value === "__default__" ? null : event.target.value,
                                                    } as Partial<SettingsType>)
                                                }
                                            >
                                                <option value="__default__">Default Dark</option>
                                                {sortedTermThemes.map(([themeKey, theme]) => (
                                                    <option key={themeKey} value={themeKey}>
                                                        {theme["display:name"] ?? themeKey}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="border-b border-white/8 px-0 py-3">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[13px] text-[#f2eee8]">TERMINAL FONT SIZE</div>
                                                <div className="mt-1 text-[11px] text-[#8e877f] uppercase">
                                                    Leave blank to use 12px
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min="6"
                                                    max="18"
                                                    step="1"
                                                    value={fontSizeInput}
                                                    className="wave-opacity-input w-[46px] border-0 border-b border-white/20 bg-transparent px-0 py-1 text-right text-[12px] text-[#f2eee8] outline-none transition-colors focus:border-[#79c0ff]"
                                                    onChange={(event) => setFontSizeInput(event.target.value)}
                                                    onBlur={(event) => commitTermFontSize(event.target.value)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === "Enter") {
                                                            commitTermFontSize((event.target as HTMLInputElement).value);
                                                        }
                                                    }}
                                                />
                                                <div className="text-[11px] tracking-[0.14em] text-[#79c0ff]">PX</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="border-b border-white/8 px-0 py-3">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[13px] text-[#f2eee8]">TERMINAL FONT</div>
                                                <div className="mt-1 text-[11px] text-[#8e877f] uppercase">
                                                    Installed monospace font family with preview
                                                </div>
                                            </div>
                                            <div className="min-w-[320px] max-w-[420px] flex-1">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={fontFamilyInput}
                                                        placeholder="DM Mono Nerd Font"
                                                        className="min-w-0 flex-1 border-0 border-b border-white/20 bg-transparent px-0 py-1 text-right text-[12px] text-[#f2eee8] outline-none transition-colors placeholder:text-[#8e877f] focus:border-[#79c0ff]"
                                                        onChange={(event) => setFontFamilyInput(event.target.value)}
                                                        onBlur={(event) => commitTermFontFamily(event.target.value)}
                                                        onKeyDown={(event) => {
                                                            if (event.key === "Enter") {
                                                                commitTermFontFamily((event.target as HTMLInputElement).value);
                                                            }
                                                        }}
                                                    />
                                                    <button
                                                        type="button"
                                                        className="border border-white/10 px-3 py-1.5 text-[10px] tracking-[0.14em] text-[#79c0ff] transition-colors hover:bg-white/[0.03]"
                                                        onClick={() => setFontBrowserOpen((open) => !open)}
                                                    >
                                                        {fontBrowserOpen ? "HIDE" : "BROWSE"}
                                                    </button>
                                                </div>
                                                {fontBrowserOpen ? (
                                                    <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-3">
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="text"
                                                                value={fontSearchInput}
                                                                placeholder="Filter fonts"
                                                                className="min-w-0 flex-1 border-0 border-b border-white/15 bg-transparent px-0 py-1 text-[12px] text-[#f2eee8] outline-none transition-colors placeholder:text-[#8e877f] focus:border-[#79c0ff]"
                                                                onChange={(event) => setFontSearchInput(event.target.value)}
                                                            />
                                                                    <div className="text-[10px] tracking-[0.12em] text-[#8e877f]">
                                                                        {fontsLoading
                                                                            ? "LOADING"
                                                                            : fontSourceState === "ready"
                                                                              ? `${installedFontOptions.length} INSTALLED`
                                                                              : fontSourceState === "unsupported"
                                                                                ? "FALLBACK"
                                                                                : fontSourceState === "error"
                                                                                  ? "UNAVAILABLE"
                                                                                  : ""}
                                                            </div>
                                                        </div>
                                                        <div className="mt-2 max-h-56 overflow-y-auto">
                                                            {visibleFontOptions.length === 0 ? (
                                                                <div className="py-3 text-[11px] text-[#8e877f] uppercase">
                                                                    No matching fonts
                                                                </div>
                                                            ) : (
                                                                visibleFontOptions.map((fontName) => {
                                                                    const isInstalled = installedFontOptions.some(
                                                                        (font) => font.family === fontName
                                                                    );
                                                                    const isSelected = fontFamilyInput === fontName;
                                                                    return (
                                                                        <button
                                                                            key={fontName}
                                                                            type="button"
                                                                            className={clsx(
                                                                                "flex w-full flex-col items-start gap-1 border-b border-white/6 px-0 py-2 text-left transition-colors hover:bg-white/[0.03]",
                                                                                isSelected && "bg-white/[0.04]"
                                                                            )}
                                                                            onClick={() => selectTerminalFont(fontName)}
                                                                        >
                                                                            <div className="flex w-full items-center justify-between gap-3">
                                                                                <div className="min-w-0 truncate normal-case text-[12px] text-[#f2eee8]">
                                                                                    {fontName}
                                                                                </div>
                                                                                <div className="text-[10px] tracking-[0.12em] text-[#8e877f]">
                                                                                    {isInstalled ? "INSTALLED" : "SUGGESTED"}
                                                                                </div>
                                                                            </div>
                                                                            <div
                                                                                className="normal-case text-[14px] leading-[1.25] tracking-normal text-[#c5d1df] [font-variant-ligatures:none] [-webkit-font-smoothing:antialiased]"
                                                                                style={{ fontFamily: makeFontPreviewFamily(fontName) }}
                                                                            >
                                                                                {fontPreviewText}
                                                                            </div>
                                                                        </button>
                                                                    );
                                                                })
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
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
                                                    className="wave-opacity-input w-[46px] border-0 border-b border-white/20 bg-transparent px-0 py-1 text-right text-[12px] text-[#f2eee8] outline-none transition-colors focus:border-[#79c0ff]"
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
                                border-radius: 0;
                                box-shadow: none;
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
    const shortcutWidgets = widgets.filter((widget) => !isBuiltInQuickWidget(widget));
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
            const quickAccessItem = quickAccessItems.find((item) => item.matcher(event));
            if (quickAccessItem != null) {
                env.createBlock(quickAccessItem.blockdef);
                return true;
            }
            if (featureWaveAppBuilder && keyutil.checkKeyPressed(event, "Cmd:Option:a")) {
                setIsAppsOpen((current) => !current);
                return true;
            }
            const widgetIndex = shortcutWidgets.slice(0, 4).findIndex((_widget, index) => getWidgetShortcutMatcher(event, index));
            if (widgetIndex !== -1) {
                handleWidgetSelect(shortcutWidgets[widgetIndex], env);
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
    }, [env, featureWaveAppBuilder, shortcutWidgets]);

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
