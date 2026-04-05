// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Input } from "@/app/element/input";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import type { WaveConfigEnv } from "@/app/view/waveconfig/waveconfigenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

interface SettingsVisualContentProps {
    model: WaveConfigViewModel;
}

const commonMonospaceFonts = [
    "DMMono Nerd Font",
    "Hack Nerd Font Mono",
    "JetBrains Mono",
    "Menlo",
    "SF Mono",
    "Monaco",
    "Consolas",
    "Fira Code",
];

export const SettingsVisualContent = memo(({ model }: SettingsVisualContentProps) => {
    const env = useWaveEnv<WaveConfigEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const settings = fullConfig?.settings ?? {};
    const termThemes = fullConfig?.termthemes ?? {};

    const currentTheme = settings["term:theme"] ?? "";
    const currentFontSize = settings["term:fontsize"];
    const currentFontFamily = settings["term:fontfamily"] ?? "";
    const currentFontFallback = settings["term:fontfallback"] ?? "";

    const [fontFamilyInput, setFontFamilyInput] = useState(currentFontFamily);
    const [fontFallbackInput, setFontFallbackInput] = useState(currentFontFallback);
    const [fontSizeInput, setFontSizeInput] = useState(currentFontSize == null ? "" : String(currentFontSize));

    useEffect(() => {
        setFontFamilyInput(currentFontFamily);
    }, [currentFontFamily]);

    useEffect(() => {
        setFontFallbackInput(currentFontFallback);
    }, [currentFontFallback]);

    useEffect(() => {
        setFontSizeInput(currentFontSize == null ? "" : String(currentFontSize));
    }, [currentFontSize]);

    const sortedThemeEntries = useMemo(() => {
        return Object.entries(termThemes).sort(([, themeA], [, themeB]) => {
            return (themeA["display:order"] ?? 0) - (themeB["display:order"] ?? 0);
        });
    }, [termThemes]);

    const applyTheme = useCallback(
        async (themeName: string) => {
            await model.updateSettingsValues({
                "term:theme": themeName === "" ? null : themeName,
            });
        },
        [model]
    );

    const applyFontSize = useCallback(
        async (rawValue: string) => {
            const trimmedValue = rawValue.trim();
            if (trimmedValue === "") {
                await model.updateSettingsValues({ "term:fontsize": null });
                return;
            }

            const parsedValue = Number(trimmedValue);
            if (!Number.isFinite(parsedValue)) {
                model.setValidationError("Font size must be a number.");
                return;
            }

            const boundedValue = Math.min(Math.max(Math.round(parsedValue), 6), 18);
            await model.updateSettingsValues({ "term:fontsize": boundedValue });
        },
        [model]
    );

    const applyFontFamily = useCallback(async () => {
        const trimmedValue = fontFamilyInput.trim();
        await model.updateSettingsValues({
            "term:fontfamily": trimmedValue === "" ? null : trimmedValue,
        });
    }, [fontFamilyInput, model]);

    const applyFontFallback = useCallback(async () => {
        const trimmedValue = fontFallbackInput.trim();
        await model.updateSettingsValues({
            "term:fontfallback": trimmedValue === "" ? null : trimmedValue,
        });
    }, [fontFallbackInput, model]);

    return (
        <div className="flex h-full flex-col gap-6 overflow-y-auto p-6 normal-case">
            <div className="space-y-1">
                <div className="text-lg font-semibold text-primary">Terminal Appearance</div>
                <div className="text-sm text-muted-foreground">
                    Cmd+, settings tab에서 기본 터미널 테마와 폰트를 바로 바꿉니다.
                </div>
            </div>

            <section className="rounded-lg border border-border bg-black/10 p-4">
                <div className="mb-1 text-sm font-medium text-primary">Terminal Theme</div>
                <div className="mb-3 text-xs text-muted-foreground">
                    새 터미널과 기본값을 따르는 터미널 블록에 적용됩니다.
                </div>
                <select
                    value={currentTheme}
                    onChange={(event) => void applyTheme(event.target.value)}
                    className="w-full rounded-md border border-border bg-[var(--form-element-bg-color)] px-3 py-2 text-sm text-primary outline-none transition-colors focus:border-[var(--form-element-primary-color)]"
                >
                    <option value="">Default Dark</option>
                    {sortedThemeEntries.map(([themeKey, theme]) => (
                        <option key={themeKey} value={themeKey}>
                            {theme["display:name"] ?? themeKey}
                        </option>
                    ))}
                </select>
            </section>

            <section className="rounded-lg border border-border bg-black/10 p-4">
                <div className="mb-1 text-sm font-medium text-primary">Terminal Font Size</div>
                <div className="mb-3 text-xs text-muted-foreground">
                    비워두면 기본값 12px로 돌아갑니다. 입력 범위는 6px부터 18px까지입니다.
                </div>
                <div className="flex items-center gap-3">
                    <Input
                        value={fontSizeInput}
                        onChange={setFontSizeInput}
                        onBlur={() => void applyFontSize(fontSizeInput)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                void applyFontSize(fontSizeInput);
                            }
                        }}
                        className="max-w-24"
                        placeholder="12"
                        isNumber={true}
                    />
                    <span className="text-sm text-muted-foreground">px</span>
                </div>
            </section>

            <section className="rounded-lg border border-border bg-black/10 p-4">
                <div className="mb-1 text-sm font-medium text-primary">Terminal Font Family</div>
                <div className="mb-3 text-xs text-muted-foreground">
                    시스템에 설치된 모노스페이스 폰트를 입력하세요. 비우면 앱 기본 폰트를 사용합니다.
                </div>
                <div className="flex flex-col gap-3">
                    <Input
                        value={fontFamilyInput}
                        onChange={setFontFamilyInput}
                        onBlur={() => void applyFontFamily()}
                        placeholder='예: "JetBrains Mono"'
                    />
                    <div className="flex flex-wrap gap-2">
                        {commonMonospaceFonts.map((fontName) => (
                            <button
                                key={fontName}
                                type="button"
                                onClick={() => {
                                    setFontFamilyInput(fontName);
                                    void model.updateSettingsValues({ "term:fontfamily": fontName });
                                }}
                                className="rounded-full border border-border px-3 py-1 text-xs text-secondary transition-colors hover:bg-highlightbg hover:text-primary cursor-pointer"
                            >
                                {fontName}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => {
                                setFontFamilyInput("");
                                void model.updateSettingsValues({ "term:fontfamily": null });
                            }}
                            className="rounded-full border border-border px-3 py-1 text-xs text-secondary transition-colors hover:bg-highlightbg hover:text-primary cursor-pointer"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            </section>

            <section className="rounded-lg border border-border bg-black/10 p-4">
                <div className="mb-1 text-sm font-medium text-primary">Terminal Font Fallback</div>
                <div className="mb-3 text-xs text-muted-foreground">
                    기본 폰트에 없는 glyph만 대체 렌더링합니다. Nerd icon 보강용 폰트를 넣으면 됩니다.
                </div>
                <div className="flex flex-col gap-3">
                    <Input
                        value={fontFallbackInput}
                        onChange={setFontFallbackInput}
                        onBlur={() => void applyFontFallback()}
                        placeholder='예: "Hack Nerd Font Mono"'
                    />
                    <div className="flex flex-wrap gap-2">
                        {["Hack Nerd Font Mono", "JetBrainsMonoNL Nerd Font Mono"].map((fontName) => (
                            <button
                                key={fontName}
                                type="button"
                                onClick={() => {
                                    setFontFallbackInput(fontName);
                                    void model.updateSettingsValues({ "term:fontfallback": fontName });
                                }}
                                className="rounded-full border border-border px-3 py-1 text-xs text-secondary transition-colors hover:bg-highlightbg hover:text-primary cursor-pointer"
                            >
                                {fontName}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => {
                                setFontFallbackInput("");
                                void model.updateSettingsValues({ "term:fontfallback": null });
                            }}
                            className="rounded-full border border-border px-3 py-1 text-xs text-secondary transition-colors hover:bg-highlightbg hover:text-primary cursor-pointer"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
});

SettingsVisualContent.displayName = "SettingsVisualContent";
