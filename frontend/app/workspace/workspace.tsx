// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIPanel } from "@/app/aipanel/aipanel";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { computeThemeChromeVars, DefaultTermTheme } from "@/app/view/term/termutil";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { Widgets } from "@/app/workspace/widgets";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import * as WOS from "@/app/store/wos";
import { atoms, getApi, getSettingsKeyAtom } from "@/store/global";
import { isMacOS } from "@/util/platformutil";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import {
    ImperativePanelGroupHandle,
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

const MacOSTabBarSpacer = memo(() => {
    return (
        <div
            className="w-full shrink-0"
            style={
                {
                    WebkitAppRegion: "drag",
                    backdropFilter: "blur(20px)",
                    background: "var(--term-header-bg, rgba(0, 0, 0, 0.35))",
                    borderBottom: "1px solid var(--term-header-border, var(--border-color))",
                } as React.CSSProperties
            }
        />
    );
});
MacOSTabBarSpacer.displayName = "MacOSTabBarSpacer";

const FloatingTabSwitcherItem = memo(
    ({ tabId, active, onSelect }: { tabId: string; active: boolean; onSelect: () => void }) => {
        const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
        const tabData = useAtomValue(tabAtom);
        const tabName = tabData?.name?.trim() || "New Tab";

        return (
            <button
                type="button"
                onClick={onSelect}
                className={`min-w-[84px] max-w-[132px] rounded-2xl px-4 py-2 text-[12px] font-medium tracking-[0.01em] transition-all duration-150 ease-out ${
                    active
                        ? "bg-white/22 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                        : "bg-transparent text-white/82 hover:bg-white/12 hover:text-white"
                }`}
            >
                <div className="w-full truncate text-center">{tabName}</div>
            </button>
        );
    }
);
FloatingTabSwitcherItem.displayName = "FloatingTabSwitcherItem";

const FloatingTabSwitcher = memo(({ workspace }: { workspace: Workspace }) => {
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const activeTabId = useAtomValue(atoms.staticTabId);
    const visible = useAtomValue(workspaceLayoutModel.floatingTabSwitcherVisibleAtom);
    const tabIds = workspace?.tabids ?? [];

    useEffect(() => {
        if (!visible) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                workspaceLayoutModel.setFloatingTabSwitcherVisible(false);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [visible, workspaceLayoutModel]);

    if (!visible || tabIds.length === 0) {
        return null;
    }

    return (
        <div className="pointer-events-none absolute inset-0 z-[220] flex items-center justify-center">
            <button
                type="button"
                className="pointer-events-auto absolute inset-0 bg-black/6"
                onClick={() => workspaceLayoutModel.setFloatingTabSwitcherVisible(false)}
                aria-label="Close tab switcher"
            />
            <div className="pointer-events-auto relative inline-flex max-w-[calc(100vw-56px)] items-center overflow-hidden rounded-[26px] border border-white/18 bg-transparent shadow-none backdrop-blur-0">
                {tabIds.map((id) => (
                    <FloatingTabSwitcherItem
                        key={id}
                        tabId={id}
                        active={id === activeTabId}
                        onSelect={() => {
                            getApi().setActiveTab(id);
                            workspaceLayoutModel.setFloatingTabSwitcherVisible(false);
                        }}
                    />
                ))}
            </div>
        </div>
    );
});
FloatingTabSwitcher.displayName = "FloatingTabSwitcher";

const WorkspaceElem = memo(() => {
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const termThemeName = useAtomValue(getSettingsKeyAtom("term:theme")) ?? DefaultTermTheme;
    const showLeftTabBar = false;
    const showBottomTabBar = false;
    const showTopTabBar = false;
    const aiPanelVisible = useAtomValue(workspaceLayoutModel.panelVisibleAtom);
    const widgetsSidebarVisible = useAtomValue(workspaceLayoutModel.widgetsSidebarVisibleAtom);
    const windowWidth = window.innerWidth;
    const leftGroupInitialPct = workspaceLayoutModel.getLeftGroupInitialPercentage(windowWidth, showLeftTabBar);
    const innerVTabInitialPct = workspaceLayoutModel.getInnerVTabInitialPercentage(windowWidth, showLeftTabBar);
    const innerAIPanelInitialPct = workspaceLayoutModel.getInnerAIPanelInitialPercentage(windowWidth, showLeftTabBar);
    const outerPanelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const innerPanelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const aiPanelRef = useRef<ImperativePanelHandle>(null);
    const vtabPanelRef = useRef<ImperativePanelHandle>(null);
    const panelContainerRef = useRef<HTMLDivElement>(null);
    const aiPanelWrapperRef = useRef<HTMLDivElement>(null);
    const vtabPanelWrapperRef = useRef<HTMLDivElement>(null);

    // showLeftTabBar is passed as a seed value only; subsequent changes are handled by setShowLeftTabBar below.
    // Do NOT add showLeftTabBar as a dep here — re-registering refs on config changes would redundantly re-run commitLayouts.
    useEffect(() => {
        if (
            aiPanelRef.current &&
            outerPanelGroupRef.current &&
            innerPanelGroupRef.current &&
            panelContainerRef.current &&
            aiPanelWrapperRef.current
        ) {
            workspaceLayoutModel.registerRefs(
                aiPanelRef.current,
                outerPanelGroupRef.current,
                innerPanelGroupRef.current,
                panelContainerRef.current,
                aiPanelWrapperRef.current,
                vtabPanelRef.current ?? undefined,
                vtabPanelWrapperRef.current ?? undefined,
                showLeftTabBar
            );
        }
    }, []);

    useEffect(() => {
        const isVisible = workspaceLayoutModel.getAIPanelVisible();
        getApi().setWaveAIOpen(isVisible);
    }, []);

    useEffect(() => {
        window.addEventListener("resize", workspaceLayoutModel.handleWindowResize);
        return () => window.removeEventListener("resize", workspaceLayoutModel.handleWindowResize);
    }, []);

    useEffect(() => {
        workspaceLayoutModel.setShowLeftTabBar(showLeftTabBar);
    }, [showLeftTabBar]);

    useEffect(() => {
        const handleFocus = () => workspaceLayoutModel.syncVTabWidthFromMeta();
        window.addEventListener("focus", handleFocus);
        return () => window.removeEventListener("focus", handleFocus);
    }, []);

    const innerHandleVisible = showLeftTabBar && aiPanelVisible;
    const innerHandleClass = `bg-transparent hover:bg-zinc-500/20 transition-colors ${innerHandleVisible ? "relative z-10 w-px -mx-px" : "w-0 pointer-events-none"}`;
    const outerHandleVisible = showLeftTabBar || aiPanelVisible;
    const outerHandleClass = `bg-transparent hover:bg-zinc-500/20 transition-colors ${outerHandleVisible ? "relative z-10 w-px -mx-px" : "w-0 pointer-events-none"}`;
    const tabChromeVars = computeThemeChromeVars(fullConfig, termThemeName, 0) as React.CSSProperties;

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden" style={tabChromeVars}>
            {showTopTabBar && !(showLeftTabBar && isMacOS()) && (
                <TabBar key={ws.oid} workspace={ws} noTabs={showLeftTabBar} position="top" />
            )}
            {showLeftTabBar && isMacOS() && <MacOSTabBarSpacer />}
            <div ref={panelContainerRef} className="relative flex flex-row flex-grow overflow-hidden">
                <ErrorBoundary key={tabId}>
                    <PanelGroup
                        direction="horizontal"
                        onLayout={workspaceLayoutModel.handleOuterPanelLayout}
                        ref={outerPanelGroupRef}
                    >
                        <Panel order={0} defaultSize={leftGroupInitialPct} className="min-w-0 overflow-hidden">
                            <PanelGroup
                                direction="horizontal"
                                onLayout={workspaceLayoutModel.handleInnerPanelLayout}
                                ref={innerPanelGroupRef}
                            >
                                <Panel
                                    ref={vtabPanelRef}
                                    collapsible
                                    defaultSize={innerVTabInitialPct}
                                    order={0}
                                    className="min-w-0 overflow-hidden"
                                >
                                    <div ref={vtabPanelWrapperRef} className="w-full h-full">
                                    </div>
                                </Panel>
                                <PanelResizeHandle className={innerHandleClass} />
                                <Panel
                                    ref={aiPanelRef}
                                    collapsible
                                    defaultSize={innerAIPanelInitialPct}
                                    order={1}
                                    className="min-w-0 overflow-hidden"
                                >
                                    <div
                                        ref={aiPanelWrapperRef}
                                        className={`w-full h-full pr-0.5 ${aiPanelVisible ? "" : "opacity-0"}`}
                                    >
                                        {tabId !== "" && aiPanelVisible && <AIPanel roundTopLeft={showLeftTabBar} />}
                                    </div>
                                </Panel>
                            </PanelGroup>
                        </Panel>
                        <PanelResizeHandle className={outerHandleClass} />
                        <Panel order={1} defaultSize={100 - leftGroupInitialPct} className="min-w-0 overflow-hidden">
                            {tabId === "" ? (
                                <CenteredDiv>No Active Tab</CenteredDiv>
                            ) : (
                                <div className="flex h-full w-full min-w-0 flex-row overflow-hidden">
                                    <TabContent key={tabId} tabId={tabId} noTopPadding={showLeftTabBar && isMacOS()} />
                                    {widgetsSidebarVisible && <Widgets />}
                                </div>
                            )}
                        </Panel>
                    </PanelGroup>
                    <FloatingTabSwitcher workspace={ws} />
                    <ModalsRenderer />
                </ErrorBoundary>
            </div>
            {showBottomTabBar && <TabBar key={ws.oid} workspace={ws} noTabs={false} position="bottom" />}
        </div>
    );
});

WorkspaceElem.displayName = "WorkspaceElem";

export { WorkspaceElem as Workspace };
