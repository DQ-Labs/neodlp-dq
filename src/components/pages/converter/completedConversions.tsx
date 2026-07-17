import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useConversionActionStatesStore, useConverterPageStatesStore, useEnvironmentStore } from "@/services/store";
import { formatFileSize, paginate } from "@/utils";
import { ArrowUpRightIcon, CircleArrowDown, FileAudio2, FileVideo2, FolderInput, Play, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import * as fs from "@tauri-apps/plugin-fs";
import { ConversionState } from "@/types/conversion";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteConversionState } from "@/services/mutations";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import PaginationBar from "@/components/custom/paginationBar";

interface CompletedConversionProps {
    state: ConversionState;
}

interface CompletedConversionsProps {
    conversions: ConversionState[];
}

export function CompletedConversion({ state }: CompletedConversionProps) {
    const conversionActions = useConversionActionStatesStore(state => state.conversionActions);
    const setIsDeleteFileChecked = useConversionActionStatesStore(state => state.setIsDeleteFileChecked);

    const isFlatpak = useEnvironmentStore(state => state.isFlatpak);

    const queryClient = useQueryClient();
    const conversionStateDeleter = useDeleteConversionState();

    const openFile = async (filePath: string | null, app: string | null) => {
        if (filePath && await fs.exists(filePath)) {
            try {
                await invoke('open_file_with_app', { filePath: filePath, appName: app }).then(() => {
                    toast.info(`${app === 'explorer' ? 'Revealing' : 'Opening'} file`, {
                        description: `${app === 'explorer' ? 'Revealing' : 'Opening'} the file ${app === 'explorer' ? 'in' : 'with'} ${app ? app : 'default app'}.`,
                    })
                });
            } catch (e) {
                console.error(e);
                toast.error(`Failed to ${app === 'explorer' ? 'reveal' : 'open'} file`, {
                    description: `An error occurred while trying to ${app === 'explorer' ? 'reveal' : 'open'} the file.`,
                })
            }
        } else {
            toast.info("File unavailable", {
                description: `The file you are trying to ${app === 'explorer' ? 'reveal' : 'open'} does not exist.`,
            })
        }
    }

    const removeFromConversions = async (conversionState: ConversionState, delete_file: boolean) => {
        if (delete_file && conversionState.output_path) {
            try {
                if (await fs.exists(conversionState.output_path)) {
                    await fs.remove(conversionState.output_path);
                } else {
                    console.error(`File not found: "${conversionState.output_path}"`);
                }
            } catch (e) {
                console.error(e);
            }
        }

        conversionStateDeleter.mutate(conversionState.conversion_id, {
            onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: ['conversion-states'] });
                if (delete_file && conversionState.output_path) {
                    toast.success("Deleted converted file", {
                        description: `"${conversionState.input_filename}" and its converted file have been deleted successfully.`,
                    });
                } else {
                    toast.success("Removed from history", {
                        description: `"${conversionState.input_filename}" has been removed from the conversion history.`,
                    });
                }
            },
            onError: (error) => {
                console.error("Failed to delete conversion state:", error);
                toast.error("Failed to remove conversion", {
                    description: `An error occurred while trying to remove "${conversionState.input_filename}".`,
                });
            }
        })
    }

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
            <div className="w-full flex flex-col justify-between gap-2">
                <div className="flex flex-col gap-1">
                    <h4 className="truncate">{state.input_filename}</h4>
                    <p className="text-xs text-muted-foreground">
                        {state.filesize ? formatFileSize(state.filesize) : 'unknown size'}
                    </p>
                </div>
                <div className="w-full flex items-center gap-2">
                    <Button size="sm" onClick={() => openFile(state.output_path, null)}>
                        <Play className="w-4 h-4" />
                        Open
                    </Button>
                    {!isFlatpak && (
                        <Button size="sm" variant="outline" onClick={() => openFile(state.output_path, 'explorer')}>
                            <FolderInput className="w-4 h-4" />
                            Reveal
                        </Button>
                    )}
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button size="sm" variant="destructive">
                                <Trash2 className="w-4 h-4" />
                                Remove
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent size="sm">
                            <AlertDialogHeader>
                                <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
                                    <Trash2 />
                                </AlertDialogMedia>
                                <AlertDialogTitle>Remove from history?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Are you sure you want to remove this conversion from the history? You can also delete the converted file by checking the box below. This action cannot be undone.
                                </AlertDialogDescription>
                                <div className="flex items-center space-x-2 mt-1">
                                    <Checkbox id="delete-file" checked={itemActionStates.isDeleteFileChecked} onCheckedChange={() => {setIsDeleteFileChecked(state.conversion_id, !itemActionStates.isDeleteFileChecked)}} />
                                    <Label htmlFor="delete-file">Delete converted file</Label>
                                </div>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction variant="destructive" onClick={
                                    () => removeFromConversions(state, itemActionStates.isDeleteFileChecked).then(() => {
                                        setIsDeleteFileChecked(state.conversion_id, false);
                                    })
                                }>{itemActionStates.isDeleteFileChecked ? "Delete" : "Remove"}</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
        </div>
    );
}

export function CompletedConversions({ conversions }: CompletedConversionsProps) {
    const activeCompletedConversionsPage = useConverterPageStatesStore(state => state.activeCompletedConversionsPage);
    const setActiveCompletedConversionsPage = useConverterPageStatesStore(state => state.setActiveCompletedConversionsPage);

    const navigate = useNavigate();
    const paginatedCompletedConversions = paginate(conversions, activeCompletedConversionsPage, 5);

    useEffect(() => {
        if (conversions.length > 0 && activeCompletedConversionsPage > paginatedCompletedConversions.last_page) {
            setActiveCompletedConversionsPage(paginatedCompletedConversions.last_page);
        }
    }, [conversions.length, activeCompletedConversionsPage, paginatedCompletedConversions.last_page, setActiveCompletedConversionsPage]);

    return (
        <div className="w-full flex flex-col gap-2">
            {paginatedCompletedConversions.data.length > 0 ? (
                <>
                {paginatedCompletedConversions.data.map((state) => {
                    return (
                        <CompletedConversion key={state.conversion_id} state={state} />
                    );
                })}
                {paginatedCompletedConversions.pages.length > 1 && (
                    <PaginationBar
                        paginatedData={paginatedCompletedConversions}
                        setPage={setActiveCompletedConversionsPage}
                    />
                )}
                </>
            ) : (
                <Empty className="mt-10">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <CircleArrowDown className="stroke-primary" />
                        </EmptyMedia>
                        <EmptyTitle>No Completed Conversions</EmptyTitle>
                        <EmptyDescription>
                        You have not completed any conversions yet! Convert a file to see it here :)
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
