import { Download, FileCog, Settings, SquarePlay } from "lucide-react";
import { RoutesObj } from "@/types/route";

export const AllRoutes: Array<RoutesObj> = [
    {
        title: "Downloader",
        url: "/",
        icon: Download,
    },
    {
        title: "Library",
        url: "/library",
        icon: SquarePlay,
    },
    {
        title: "Converter",
        url: "/converter",
        icon: FileCog,
    },
    {
        title: "Settings",
        url: "/settings",
        icon: Settings,
    }
];