// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { recordTEvent } from "@/app/store/global";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { IconButton } from "@/element/iconbutton";
import * as util from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { BlockEnv } from "./blockenv";

interface ConnectionButtonProps {
    connection: string;
    changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
    isTerminalBlock?: boolean;
}

export const ConnectionButton = React.memo(
    React.forwardRef<HTMLDivElement, ConnectionButtonProps>(
        ({ connection, changeConnModalAtom, isTerminalBlock }: ConnectionButtonProps, ref) => {
            const waveEnv = useWaveEnv<BlockEnv>();
            const [_connModalOpen, setConnModalOpen] = jotai.useAtom(changeConnModalAtom);
            const isLocal = util.isLocalConnName(connection);
            const connStatus = jotai.useAtomValue(waveEnv.getConnStatusAtom(connection));
            const localName = jotai.useAtomValue(waveEnv.getLocalHostDisplayNameAtom());
            const clickHandler = function () {
                recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "mouse" });
                setConnModalOpen(true);
            };
            let titleText = null;
            let connDisplayName: string = null;
            let extraDisplayNameClassName = "";
            if (isLocal) {
                if (connection === "local:gitbash") {
                    titleText = "Connected to Git Bash";
                    connDisplayName = "Git Bash";
                } else {
                    titleText = "Connected to Local Machine";
                    if (localName) {
                        titleText += ` (${localName})`;
                    }
                    if (isTerminalBlock) {
                        connDisplayName = localName;
                        extraDisplayNameClassName =
                            'uppercase opacity-80 group-hover:opacity-100 [font-family:"Departure_Mono","DM_Mono_Nerd_Font",monospace]';
                    }
                }
            } else {
                titleText = "Connected to " + connection;
                if (connStatus?.status == "connecting") {
                    titleText = "Connecting to " + connection;
                } else if (connStatus?.status == "error") {
                    titleText = "Error connecting to " + connection;
                    if (connStatus?.error != null) {
                        titleText += " (" + connStatus.error + ")";
                    }
                } else if (!connStatus?.connected) {
                    titleText = "Disconnected from " + connection;
                } else if (connStatus?.connhealthstatus === "degraded" || connStatus?.connhealthstatus === "stalled") {
                    if (connStatus.connhealthstatus === "degraded") {
                        titleText = "Connection degraded: " + connection;
                    } else {
                        titleText = "Connection stalled: " + connection;
                    }
                }
            }

            const wshProblem = connection && !connStatus?.wshenabled && connStatus?.status == "connected";
            const showNoWshButton = wshProblem && !isLocal;

            return (
                <>
                    <div
                        ref={ref}
                        className="group flex items-center flex-nowrap overflow-hidden text-ellipsis min-w-0 font-normal rounded-sm cursor-pointer"
                        onClick={clickHandler}
                        title={titleText}
                    >
                        {connDisplayName ? (
                            <div
                                className={util.cn(
                                    'flex-1 min-w-0 overflow-hidden pr-1 ellipsis uppercase [font-family:"Departure_Mono","DM_Mono_Nerd_Font",monospace]',
                                    extraDisplayNameClassName
                                )}
                            >
                                {connDisplayName}
                            </div>
                        ) : isLocal ? null : (
                            <div className='flex-1 min-w-0 overflow-hidden pr-1 ellipsis uppercase [font-family:"Departure_Mono","DM_Mono_Nerd_Font",monospace]'>
                                {connection}
                            </div>
                        )}
                    </div>
                    {showNoWshButton && (
                        <IconButton
                            decl={{
                                elemtype: "iconbutton",
                                icon: "link-slash",
                                title: "wsh is not installed for this connection",
                            }}
                        />
                    )}
                </>
            );
        }
    )
);
ConnectionButton.displayName = "ConnectionButton";
