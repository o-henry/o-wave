// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { dialog, ipcMain, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { existsSync, readFileSync } from "fs";
import path from "path";
import YAML from "yaml";
import { RpcApi } from "../frontend/app/store/wshclientapi";
import { isDev } from "../frontend/util/isdev";
import { fireAndForget } from "../frontend/util/util";
import { setUserConfirmedQuit } from "./emain-activity";
import { getWaveConfigDir } from "./emain-platform";
import { delay } from "./emain-util";
import { focusedWaveWindow, getAllWaveWindows } from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";

export let updater: Updater;

type UpdateOverrideConfig = {
    provider?: string;
    url?: string;
    channel?: string;
    enabled?: boolean;
    intervalms?: number;
    installonquit?: boolean;
    startupcheck?: boolean;
};

function getUpdateOverrideConfig(): UpdateOverrideConfig | null {
    const overridePath = path.join(getWaveConfigDir(), "app-update.override.yml");
    if (!existsSync(overridePath)) {
        return null;
    }

    try {
        const rawOverride = YAML.parse(readFileSync(overridePath, { encoding: "utf8" }).toString()) as
            | UpdateOverrideConfig
            | null;
        if (!rawOverride || typeof rawOverride !== "object") {
            return null;
        }
        console.log("Using update override config:", rawOverride);
        return rawOverride;
    } catch (error) {
        console.warn("failed to read app-update override config", error);
        return null;
    }
}

function getUpdateChannel(settings: SettingsType, updateOverride: UpdateOverrideConfig | null): string {
    if (updateOverride?.channel) {
        console.log("Update channel from override:", updateOverride.channel);
        return updateOverride.channel;
    }

    const updaterConfigPath = path.join(process.resourcesPath!, "app-update.yml");
    const updaterConfig = YAML.parse(readFileSync(updaterConfigPath, { encoding: "utf8" }).toString());
    console.log("Updater config from binary:", updaterConfig);
    const updaterChannel: string = updaterConfig.channel ?? "latest";
    const settingsChannel = settings["autoupdate:channel"];
    let retVal = settingsChannel;

    // If the user setting doesn't exist yet, set it to the value of the updater config.
    // If the user was previously on the `latest` channel and has downloaded a `beta` version, update their configured channel to `beta` to prevent downgrading.
    if (!settingsChannel || (settingsChannel == "latest" && updaterChannel == "beta")) {
        console.log("Update channel setting does not exist, setting to value from updater config.");
        RpcApi.SetConfigCommand(ElectronWshClient, { "autoupdate:channel": updaterChannel });
        retVal = updaterChannel;
    }
    console.log("Update channel:", retVal);
    return retVal;
}

export class Updater {
    autoCheckInterval: NodeJS.Timeout | null;
    intervalms: number;
    autoCheckEnabled: boolean;
    startupCheckEnabled: boolean;
    availableUpdateReleaseName: string | null;
    availableUpdateReleaseNotes: string | null;
    private _status: UpdaterStatus;
    lastUpdateCheck: Date;

    constructor(settings: SettingsType) {
        const updateOverride = getUpdateOverrideConfig();

        this.intervalms = updateOverride?.intervalms ?? settings["autoupdate:intervalms"];
        console.log("Update check interval in milliseconds:", this.intervalms);
        this.autoCheckEnabled = updateOverride?.enabled ?? settings["autoupdate:enabled"];
        console.log("Update check enabled:", this.autoCheckEnabled);
        this.startupCheckEnabled = updateOverride?.startupcheck ?? this.autoCheckEnabled;
        console.log("Update startup check enabled:", this.startupCheckEnabled);

        this._status = "up-to-date";
        this.lastUpdateCheck = new Date(0);
        this.autoCheckInterval = null;
        this.availableUpdateReleaseName = null;

        autoUpdater.autoInstallOnAppQuit = updateOverride?.installonquit ?? settings["autoupdate:installonquit"];
        console.log("Install update on quit:", autoUpdater.autoInstallOnAppQuit);

        if (updateOverride?.url) {
            const feedConfig = {
                provider: updateOverride.provider ?? "generic",
                url: updateOverride.url,
                channel: updateOverride.channel,
            };
            autoUpdater.setFeedURL(feedConfig as any);
            console.log("Using overridden update feed URL:", feedConfig);
        }

        // Only update the release channel if it's specified, otherwise use the one configured in the updater.
        autoUpdater.channel = getUpdateChannel(settings, updateOverride);
        autoUpdater.allowDowngrade = false;

        autoUpdater.removeAllListeners();

        autoUpdater.on("error", (err) => {
            console.log("updater error");
            console.log(err);
            if (!err.toString()?.includes("net::ERR_INTERNET_DISCONNECTED")) this.status = "error";
        });

        autoUpdater.on("checking-for-update", () => {
            console.log("checking-for-update");
            this.status = "checking";
        });

        autoUpdater.on("update-available", () => {
            console.log("update-available; downloading...");
            this.status = "downloading";
        });

        autoUpdater.on("update-not-available", () => {
            console.log("update-not-available");
            this.status = "up-to-date";
        });

        autoUpdater.on("update-downloaded", (event) => {
            console.log("update-downloaded", [event]);
            this.availableUpdateReleaseName = event.releaseName;
            this.availableUpdateReleaseNotes = event.releaseNotes as string | null;

            // Display the update banner and create a system notification
            this.status = "ready";
            const updateNotification = new Notification({
                title: "SHIB",
                body: "A new version of SHIB is ready to install.",
            });
            updateNotification.on("click", () => {
                fireAndForget(this.promptToInstallUpdate.bind(this));
            });
            updateNotification.show();
        });
    }

    /**
     * The status of the Updater.
     */
    get status(): UpdaterStatus {
        return this._status;
    }

    private set status(value: UpdaterStatus) {
        this._status = value;
        getAllWaveWindows().forEach((window) => {
            const allTabs = Array.from(window.allLoadedTabViews.values());
            allTabs.forEach((tab) => {
                tab.webContents.send("app-update-status", value);
            });
        });
    }

    /**
     * Check for updates and start the background update check, if configured.
     */
    async start() {
        if (this.autoCheckEnabled || this.startupCheckEnabled) {
            console.log("starting updater");
            const pollIntervalMs = Math.max(5000, Math.min(this.intervalms, 600000));
            if (this.autoCheckEnabled) {
                console.log("Updater poll interval in milliseconds:", pollIntervalMs);
                this.autoCheckInterval = setInterval(() => {
                    fireAndForget(() => this.checkForUpdates(false));
                }, pollIntervalMs);
            }
            await this.checkForUpdates(false, true);
        }
    }

    /**
     * Stop the background update check, if configured.
     */
    stop() {
        console.log("stopping updater");
        if (this.autoCheckInterval) {
            clearInterval(this.autoCheckInterval);
            this.autoCheckInterval = null;
        }
    }

    /**
     * Checks if the configured interval time has passed since the last update check, and if so, checks for updates using the `autoUpdater` object
     * @param userInput Whether the user is requesting this. If so, an alert will report the result of the check.
     */
    async checkForUpdates(userInput: boolean, force = false) {
        const now = new Date();

        // Run an update check always if the user requests it, otherwise only if there's an active update check interval and enough time has elapsed.
        if (
            force ||
            userInput ||
            (this.autoCheckInterval &&
                (!this.lastUpdateCheck || Math.abs(now.getTime() - this.lastUpdateCheck.getTime()) > this.intervalms))
        ) {
            const result = await autoUpdater.checkForUpdates();

            // If the user requested this check and we do not have an available update, let them know with a popup dialog. No need to tell them if there is an update, because we show a banner once the update is ready to install.
            if (userInput && !result.downloadPromise) {
                const dialogOpts: Electron.MessageBoxOptions = {
                    type: "info",
                    message: "There are currently no updates available.",
                };
                if (focusedWaveWindow) {
                    dialog.showMessageBox(focusedWaveWindow, dialogOpts);
                }
            }

            // Only update the last check time if this is an automatic check. This ensures the interval remains consistent.
            if (!userInput) this.lastUpdateCheck = now;
        }
    }

    /**
     * Prompts the user to install the downloaded application update and restarts the application
     */
    async promptToInstallUpdate() {
        const dialogOpts: Electron.MessageBoxOptions = {
            type: "info",
            buttons: ["Restart", "Later"],
            title: "Application Update",
            message: process.platform === "win32" ? this.availableUpdateReleaseNotes : this.availableUpdateReleaseName,
            detail: "A new version has been downloaded. Restart the application to apply the updates.",
        };

        const allWindows = getAllWaveWindows();
        if (allWindows.length > 0) {
            await dialog.showMessageBox(focusedWaveWindow ?? allWindows[0], dialogOpts).then(({ response }) => {
                if (response === 0) {
                    fireAndForget(this.installUpdate.bind(this));
                }
            });
        }
    }

    /**
     * Restarts the app and installs an update if it is available.
     */
    async installUpdate() {
        if (this.status == "ready") {
            this.status = "installing";
            await delay(1000);
            setUserConfirmedQuit(true);
            autoUpdater.quitAndInstall();
        }
    }
}

export function getResolvedUpdateChannel(): string {
    return isDev() ? "dev" : (autoUpdater.channel ?? "latest");
}

ipcMain.on("install-app-update", () => fireAndForget(updater?.promptToInstallUpdate.bind(updater)));
ipcMain.on("get-app-update-status", (event) => {
    event.returnValue = updater?.status;
});
ipcMain.on("get-updater-channel", (event) => {
    event.returnValue = getResolvedUpdateChannel();
});

let autoUpdateLock = false;

/**
 * Configures the auto-updater based on the user's preference
 */
export async function configureAutoUpdater() {
    if (isDev()) {
        console.log("skipping auto-updater in dev mode");
        return;
    }

    // simple lock to prevent multiple auto-update configuration attempts, this should be very rare
    if (autoUpdateLock) {
        console.log("auto-update configuration already in progress, skipping");
        return;
    }
    autoUpdateLock = true;

    try {
        console.log("Configuring updater");
        const settings = (await RpcApi.GetFullConfigCommand(ElectronWshClient)).settings;
        updater = new Updater(settings);
        await updater.start();
    } catch (e) {
        console.warn("error configuring updater", e.toString());
    }

    autoUpdateLock = false;
}
