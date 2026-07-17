import { Button } from "@/components/ui/button";
import Heading from "@/components/heading";
import { open } from "@tauri-apps/plugin-dialog";
import { useConverterContext } from "@/providers/converterContextProvider";
import { useConversionStatesStore, useConverterPageStatesStore } from "@/services/store";
import { toast } from "sonner";
import { FileCog } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { QueuedConversions } from "@/components/pages/converter/queuedConversions";
import { CompletedConversions } from "@/components/pages/converter/completedConversions";

const MEDIA_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'aiff', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v'];

export default function ConverterPage() {
    const { startConversion } = useConverterContext();
    const conversionStates = useConversionStatesStore(state => state.conversionStates);

    const activeTab = useConverterPageStatesStore(state => state.activeTab);
    const setActiveTab = useConverterPageStatesStore(state => state.setActiveTab);

    const queuedConversions = conversionStates
        .filter(state => state.conversion_status !== 'completed')
        .sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return dateA - dateB;
        });
    const completedConversions = conversionStates
        .filter(state => state.conversion_status === 'completed')
        .sort((a, b) => {
            const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return dateB - dateA;
        });
    const activeConversions = conversionStates.filter(state =>
        ['starting', 'converting'].includes(state.conversion_status)
    );

    const handlePickFiles = async () => {
        try {
            const files = await open({
                multiple: true,
                directory: false,
                filters: [
                    { name: 'Media', extensions: MEDIA_EXTENSIONS },
                ],
            });
            if (!files) return;
            const paths = Array.isArray(files) ? files : [files];
            if (paths.length === 0) return;

            for (const path of paths) {
                try {
                    await startConversion(path);
                } catch (error) {
                    console.error(`Error enqueueing file "${path}":`, error);
                }
            }

            if (paths.length > 1) {
                toast.success("Files Queued", {
                    description: `${paths.length} files were added to the conversion queue.`,
                });
            }
        } catch (error) {
            console.error("Error selecting files:", error);
            toast.error("Failed to select files", {
                description: "An error occurred while trying to select the files. Please try again.",
            });
        }
    };

    return (
        <div className="container mx-auto p-4 space-y-4">
            <Heading title="Converter" description="Convert audio and video files with ffmpeg" />
            <Button onClick={handlePickFiles}>
                <FileCog className="h-4 w-4" />
                Select Files to Convert
            </Button>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="queue">Queue {(queuedConversions.length > 0 && activeConversions.length <= 0) && (`(${queuedConversions.length})`)} {activeConversions.length > 0 && (<Badge className="h-4 min-w-4 rounded-full px-1 font-mono tabular-nums ml-1.5 mt-0.5">{activeConversions.length}</Badge>)}</TabsTrigger>
                    <TabsTrigger value="completed">Completed {completedConversions.length > 0 && (`(${completedConversions.length})`)}</TabsTrigger>
                </TabsList>
                <TabsContent value="queue">
                    <QueuedConversions conversions={queuedConversions} />
                </TabsContent>
                <TabsContent value="completed">
                    <CompletedConversions conversions={completedConversions} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
