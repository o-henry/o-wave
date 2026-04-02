// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import {
    ExpandableMenu,
    ExpandableMenuItem,
    ExpandableMenuItemGroup,
    ExpandableMenuItemGroupTitle,
    ExpandableMenuItemLeftElement,
    ExpandableMenuItemRightElement,
} from "@/element/expandablemenu";
import { Popover, PopoverButton, PopoverContent } from "@/element/popover";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { atom, PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { splitAtom } from "jotai/utils";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { CSSProperties, forwardRef, useCallback, useEffect } from "react";
import AddFourSVG from "../asset/add-four-svgrepo-com.svg";
import WorkspaceSVG from "../asset/workspace.svg";
import { IconButton } from "../element/iconbutton";
import { globalStore } from "@/app/store/jotaiStore";
import { makeORef } from "../store/wos";
import { waveEventSubscribeSingle } from "../store/wps";
import { WorkspaceEditor } from "./workspaceeditor";
import { WorkspaceIcon } from "./workspaceicon";
import "./workspaceswitcher.scss";

export type WorkspaceSwitcherEnv = WaveEnvSubset<{
    electron: {
        deleteWorkspace: WaveEnv["electron"]["deleteWorkspace"];
        createWorkspace: WaveEnv["electron"]["createWorkspace"];
        switchWorkspace: WaveEnv["electron"]["switchWorkspace"];
    };
    atoms: {
        workspace: WaveEnv["atoms"]["workspace"];
    };
    services: {
        workspace: WaveEnv["services"]["workspace"];
    };
    wos: WaveEnv["wos"];
}>;

type WorkspaceListEntry = {
    windowId: string;
    workspace: Workspace;
};

type WorkspaceList = WorkspaceListEntry[];
const workspaceMapAtom = atom<WorkspaceList>([]);
const workspaceSplitAtom = splitAtom(workspaceMapAtom);
const editingWorkspaceAtom = atom<string>();

function useWorkspaceSwitcherState() {
    const env = useWaveEnv<WorkspaceSwitcherEnv>();
    const setWorkspaceList = useSetAtom(workspaceMapAtom);
    const activeWorkspace = useAtomValueSafe(env.atoms.workspace);
    const workspaceList = useAtomValue(workspaceSplitAtom);
    const setEditingWorkspace = useSetAtom(editingWorkspaceAtom);

    const updateWorkspaceList = useCallback(async () => {
        const workspaceList = await env.services.workspace.ListWorkspaces();
        if (!workspaceList) {
            return;
        }
        const newList: WorkspaceList = [];
        for (const entry of workspaceList) {
            // This just ensures that the atom exists for easier setting of the object
            globalStore.get(env.wos.getWaveObjectAtom(makeORef("workspace", entry.workspaceid)));
            newList.push({
                windowId: entry.windowid,
                workspace: await env.services.workspace.GetWorkspace(entry.workspaceid),
            });
        }
        setWorkspaceList(newList);
    }, []);

    useEffect(
        () =>
            waveEventSubscribeSingle({
                eventType: "workspace:update",
                handler: () => fireAndForget(updateWorkspaceList),
            }),
        []
    );

    useEffect(() => {
        fireAndForget(updateWorkspaceList);
    }, []);

    const onDeleteWorkspace = useCallback((workspaceId: string) => {
        env.electron.deleteWorkspace(workspaceId);
    }, []);

    const isActiveWorkspaceSaved = !!(activeWorkspace?.name && activeWorkspace?.icon);

    const workspaceIcon = isActiveWorkspaceSaved ? (
        <WorkspaceIcon icon={activeWorkspace.icon} fw={false} style={{ color: activeWorkspace.color }} />
    ) : (
        <WorkspaceSVG />
    );

    const saveWorkspace = () => {
        if (!activeWorkspace?.oid) {
            return;
        }
        fireAndForget(async () => {
            await env.services.workspace.UpdateWorkspace(activeWorkspace.oid, "", "", "", true);
            await updateWorkspaceList();
            setEditingWorkspace(activeWorkspace.oid);
        });
    };

    return {
        env,
        activeWorkspace,
        workspaceList,
        setEditingWorkspace,
        updateWorkspaceList,
        onDeleteWorkspace,
        saveWorkspace,
        isActiveWorkspaceSaved,
        workspaceIcon,
    };
}

type WorkspaceSwitcherProps = {
    mode?: "button" | "panel" | "content";
};

const WorkspaceSwitcher = forwardRef<HTMLDivElement, WorkspaceSwitcherProps>(({ mode = "button" }, ref) => {
    const {
        env,
        activeWorkspace,
        workspaceList,
        setEditingWorkspace,
        updateWorkspaceList,
        onDeleteWorkspace,
        saveWorkspace,
        isActiveWorkspaceSaved,
        workspaceIcon,
    } = useWorkspaceSwitcherState();

    const content = (
        <div className={clsx("workspace-switcher-content", mode === "content" && "workspace-switcher-embedded")}>
            <OverlayScrollbarsComponent className={"scrollable"} options={{ scrollbars: { autoHide: "leave" } }}>
                <ExpandableMenu noIndent singleOpen>
                    {workspaceList.map((entry, i) => (
                        <WorkspaceSwitcherItem
                            key={i}
                            entryAtom={entry}
                            onDeleteWorkspace={onDeleteWorkspace}
                            closeOnSwitch={mode === "button"}
                        />
                    ))}
                </ExpandableMenu>
            </OverlayScrollbarsComponent>

            <div className="actions">
                {isActiveWorkspaceSaved ? (
                    <ExpandableMenuItem onClick={() => env.electron.createWorkspace()}>
                        <ExpandableMenuItemLeftElement>
                            <i className="fa-sharp fa-solid fa-plus"></i>
                        </ExpandableMenuItemLeftElement>
                        <div className="content">CREATE NEW WORKSPACE</div>
                    </ExpandableMenuItem>
                ) : (
                    <ExpandableMenuItem onClick={() => saveWorkspace()}>
                        <div className="content">SAVE WORKSPACE</div>
                    </ExpandableMenuItem>
                )}
            </div>
        </div>
    );

    return (
        mode === "panel" ? (
            <div className="workspace-sidebar-panel" ref={ref}>
                <div className="workspace-sidebar-header">
                    <div className="workspace-sidebar-title">WORKSPACES</div>
                    <div className="workspace-sidebar-shortcut">CMD+\</div>
                </div>
                <div className="workspace-sidebar-caption">
                    {activeWorkspace?.name && activeWorkspace?.icon ? "OPEN WORKSPACE" : "SAVE WORKSPACE"}
                </div>
                <OverlayScrollbarsComponent
                    className="workspace-sidebar-scrollable"
                    options={{ scrollbars: { autoHide: "leave" } }}
                >
                    <ExpandableMenu noIndent singleOpen>
                        {workspaceList.map((entry, i) => (
                            <WorkspaceSwitcherItem
                                key={i}
                                entryAtom={entry}
                                onDeleteWorkspace={onDeleteWorkspace}
                                closeOnSwitch={false}
                            />
                        ))}
                    </ExpandableMenu>
                </OverlayScrollbarsComponent>
                <div className="workspace-sidebar-actions">
                    <button
                        type="button"
                        className="workspace-sidebar-action"
                        onClick={() => fireAndForget(updateWorkspaceList)}
                    >
                        OPEN
                    </button>
                    <button
                        type="button"
                        className="workspace-sidebar-action"
                        onClick={() => {
                            if (activeWorkspace?.name && activeWorkspace?.icon) {
                                fireAndForget(updateWorkspaceList);
                            } else {
                                saveWorkspace();
                            }
                        }}
                    >
                        {activeWorkspace?.name && activeWorkspace?.icon ? "REFRESH" : "SAVE"}
                    </button>
                    <button
                        type="button"
                        className="workspace-sidebar-action"
                        onClick={() => env.electron.createWorkspace()}
                    >
                        NEW
                    </button>
                </div>
            </div>
        ) : mode === "content" ? (
            <div ref={ref}>{content}</div>
        ) : (
        <Popover
            className="workspace-switcher-popover"
            placement="bottom-start"
            onDismiss={() => setEditingWorkspace(null)}
            ref={ref}
        >
            <PopoverButton
                className="workspace-switcher-button grey"
                as="div"
                onClick={() => {
                    fireAndForget(updateWorkspaceList);
                }}
            >
                <span className="workspace-icon">{workspaceIcon}</span>
            </PopoverButton>
            <PopoverContent>{content}</PopoverContent>
        </Popover>
        )
    );
});

const WorkspaceSwitcherItem = ({
    entryAtom,
    onDeleteWorkspace,
    closeOnSwitch,
}: {
    entryAtom: PrimitiveAtom<WorkspaceListEntry>;
    onDeleteWorkspace: (workspaceId: string) => void;
    closeOnSwitch: boolean;
}) => {
    const env = useWaveEnv<WorkspaceSwitcherEnv>();
    const activeWorkspace = useAtomValueSafe(env.atoms.workspace);
    const [workspaceEntry, setWorkspaceEntry] = useAtom(entryAtom);
    const [editingWorkspace, setEditingWorkspace] = useAtom(editingWorkspaceAtom);

    const workspace = workspaceEntry.workspace;
    const isCurrentWorkspace = activeWorkspace?.oid === workspace.oid;

    const setWorkspace = useCallback((newWorkspace: Workspace) => {
        setWorkspaceEntry({ ...workspaceEntry, workspace: newWorkspace });
        if (newWorkspace.name != "") {
            fireAndForget(() =>
                env.services.workspace.UpdateWorkspace(
                    workspace.oid,
                    newWorkspace.name,
                    newWorkspace.icon,
                    newWorkspace.color,
                    false
                )
            );
        }
    }, []);

    const isActive = !!workspaceEntry.windowId;
    const editIconDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        className: "edit",
        icon: <AddFourSVG />,
        title: "Edit workspace",
        click: (e) => {
            e.stopPropagation();
            if (editingWorkspace === workspace.oid) {
                setEditingWorkspace(null);
            } else {
                setEditingWorkspace(workspace.oid);
            }
        },
    };
    const windowIconDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        className: "window",
        noAction: true,
        icon: isCurrentWorkspace ? "check" : "window",
        title: isCurrentWorkspace ? "This is your current workspace" : "This workspace is open",
    };

    const isEditing = editingWorkspace === workspace.oid;

    return (
        <ExpandableMenuItemGroup
            key={workspace.oid}
            isOpen={isEditing}
            className={clsx({ "is-current": isCurrentWorkspace })}
        >
            <ExpandableMenuItemGroupTitle
                onClick={() => {
                    env.electron.switchWorkspace(workspace.oid);
                    if (closeOnSwitch) {
                        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
                    }
                }}
            >
                <div
                    className="menu-group-title-wrapper"
                    style={
                        {
                            "--workspace-color": workspace.color,
                        } as CSSProperties
                    }
                >
                    <ExpandableMenuItemLeftElement>
                        <WorkspaceIcon
                            icon={workspace.icon}
                            className="left-icon"
                            style={{ color: workspace.color }}
                        />
                    </ExpandableMenuItemLeftElement>
                    <div className="label">{workspace.name}</div>
                    <ExpandableMenuItemRightElement>
                        <div className="icons">
                            <IconButton decl={editIconDecl} />
                            {isActive && <IconButton decl={windowIconDecl} />}
                        </div>
                    </ExpandableMenuItemRightElement>
                </div>
            </ExpandableMenuItemGroupTitle>
            <ExpandableMenuItem>
                <WorkspaceEditor
                    title={workspace.name}
                    icon={workspace.icon}
                    color={workspace.color}
                    focusInput={isEditing}
                    onTitleChange={(title) => setWorkspace({ ...workspace, name: title })}
                    onColorChange={(color) => setWorkspace({ ...workspace, color })}
                    onIconChange={(icon) => setWorkspace({ ...workspace, icon })}
                    onDeleteWorkspace={() => onDeleteWorkspace(workspace.oid)}
                />
            </ExpandableMenuItem>
        </ExpandableMenuItemGroup>
    );
};

export { WorkspaceSwitcher };
