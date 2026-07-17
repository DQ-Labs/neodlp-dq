import { IndeterminateProgress } from "@/components/custom/indeterminateProgress";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useConverterContext } from "@/providers/converterContextProvider";
import { useConversionActionStatesStore } from "@/services/store";
import { formatFileSize } from "@/utils";
import { ArrowUpRightIcon, CircleCheck, FileAudio2, FileVideo2, Info, Loader2, X } from "lucide-react";
import { ConversionState } from "@/types/conversion";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useNavigate } from "react-router-dom";

interface QueuedConversionProps {
    state: ConversionState;
}

interface QueuedConversionsProps {
    conversions: ConversionState[];
}

export function QueuedConversion({ state }: QueuedConversionProps) {
    const conversionActions = useConversionActionStatesStore(state => state.conversionActions);
    const setIsCancelingConversion = useConversionActionStatesStore(state => state.setIsCancelingConversion);

    const { cancelConversion } = useConverterContext();

    const itemActionStates = conversionActions[state.conversion_id] || {
        isCanceling: false,
        isDeleteFileChecked: false,
    };

    const isVideo = state.conversion_type === 'video_to_mp4';

    return (
        <div className="p-4 border border-border rounded-lg flex gap-4" key={state.conversion_id}>
            <div className="w-[15%] flex items-center justify-center">
                <span className="w-full flex items-center justify-center text-xs border border-border py-2 px-2 rounded">
                    {isVideo ? (
                        <FileVideo2 className="w-4 h-4 mr-2 stroke-primary" />
                    ) : (
                        <FileAudio2 className="w-4 h-4 mr-2 stroke-primary" />
                    )}
                    .{state.output_format.toUpperCase()}
                </span>
            </div>
            <div className="w-full flex flex-col justify-between">
                <div className="flex flex-col gap-1">
                    <h4 className="truncate">{state.input_filename}</h4>
                    {state.conversion_status === 'starting' && (
                        <IndeterminateProgress indeterminate={true} className="w-full" />
                    )}
                    {state.conversion_status === 'converting' && state.progress === null && (
                        <IndeterminateProgress indeterminate={true} className="w-full" />
                    )}
                    {state.conversion_status === 'converting' && state.progress !== null && (
                        <div className="w-full flex items-center gap-2">
                            <span className="text-sm text-nowrap">{state.progress.toFixed(0)}%</span>
                            <Progress value={state.progress} className="mt-[0.2rem]" />
                        </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                        {state.conversion_status === 'errored' ? (
                            <span className="text-destructive"><Info className="inline size-3 mb-1 mr-0.5" /> Errored{state.error_message ? `: ${state.error_message}` : ''}</span>
                        ) : (
                            <span>{state.conversion_status.charAt(0).toUpperCase() + state.conversion_status.slice(1)}</span>
                        )} {
                        state.input_filesize && (
                            <><span className="text-primary">•</span> {formatFileSize(state.input_filesize)}</>
                        )} {
                        state.conversion_status === 'converting' && state.speed && (
                            <><span className="text-primary">•</span> Speed: {state.speed.toFixed(2)}x</>
                        )}
                    </div>
                </div>
                <div className="w-full flex items-center gap-2 mt-2">
                    <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                        setIsCancelingConversion(state.conversion_id, true);
                        try {
                            await cancelConversion(state);
                            toast.success(state.conversion_status === 'errored' ? "Removed Conversion" : "Canceled Conversion", {
                                description: `The conversion for "${state.input_filename}" has been ${state.conversion_status === 'errored' ? 'removed' : 'canceled'}.`,
                            });
                        } catch (e) {
                            console.error(e);
                            toast.error("Failed to Cancel Conversion", {
                                description: `An error occurred while trying to cancel the conversion for "${state.input_filename}".`,
                            });
                        } finally {
                            setIsCancelingConversion(state.conversion_id, false);
                        }
                    }}
                    disabled={itemActionStates.isCanceling}
                    >
                        {itemActionStates.isCanceling ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {state.conversion_status === 'errored' ? 'Removing' : 'Canceling'}
                            </>
                        ) : (
                            <>
                                <X className="w-4 h-4" />
                                {state.conversion_status === 'errored' ? 'Remove' : 'Cancel'}
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function QueuedConversions({ conversions }: QueuedConversionsProps) {
    const navigate = useNavigate();

    return (
        <div className="w-full flex flex-col gap-2">
            {conversions.length > 0 ? (
                conversions.map((state) => {
                    return (
                        <QueuedConversion key={state.conversion_id} state={state} />
                    );
                })
            ) : (
                <Empty className="mt-10">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <CircleCheck className="stroke-primary" />
                        </EmptyMedia>
                        <EmptyTitle>No Conversions in Queue</EmptyTitle>
                        <EmptyDescription>
                        You have all caught up! Select a file to convert to see it here :)
                        </EmptyDescription>
                    </EmptyHeader>
                    <Button
                        variant="link"
                        className="text-muted-foreground"
                        size="sm"
                        onClick={() => navigate("/converter")}
                    >
                        Select a File to Convert <ArrowUpRightIcon />
                    </Button>
                </Empty>
            )}
        </div>
    );
}
