import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { CSSProperties, HTMLAttributes, memo } from "react";

const workspaceSvgIcons: Record<string, string> = {
    "workspace@add": "/workspace-icons/add_.svg",
    "workspace@box-outer-light-dashed-all": "/workspace-icons/box-outer-light-dashed-all.svg",
    "workspace@box-2": "/workspace-icons/box-2.svg",
    "workspace@box": "/workspace-icons/box.svg",
    "workspace@chart": "/workspace-icons/chart.svg",
    "workspace@circle": "/workspace-icons/circle.svg",
    "workspace@terminal": "/workspace-icons/terminal.svg",
    "workspace@web": "/workspace-icons/web.svg",
    "workspace@terminal-alt": "/workspace-icons/terminal-alt.svg",
};

type WorkspaceIconProps = {
    icon: string;
    className?: string;
    style?: CSSProperties;
    fw?: boolean;
} & HTMLAttributes<HTMLElement>;

const WorkspaceIconComponent = ({ icon, className, style, fw = true, ...props }: WorkspaceIconProps) => {
    const svgPath = workspaceSvgIcons[icon];
    if (svgPath != null) {
        return (
            <span
                className={clsx("workspace-icon-mask", className)}
                style={
                    {
                        ...style,
                        backgroundColor: "currentColor",
                        maskImage: `url("${svgPath}")`,
                        maskRepeat: "no-repeat",
                        maskPosition: "center",
                        maskSize: "contain",
                        WebkitMaskImage: `url("${svgPath}")`,
                        WebkitMaskRepeat: "no-repeat",
                        WebkitMaskPosition: "center",
                        WebkitMaskSize: "contain",
                    } as CSSProperties
                }
                aria-hidden="true"
                {...props}
            />
        );
    }

    return <i className={clsx(makeIconClass(icon, fw), className)} style={style} aria-hidden="true" {...props} />;
};

export const WorkspaceIcon = memo(WorkspaceIconComponent);
