import { ConversionState } from "@/types/conversion";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef } from "react";
import { useConversionStatesStore } from "@/services/store";
import { generateSafeFilePath } from "@/utils";
import { Command } from "@tauri-apps/plugin-shell";
import { useDeleteConversionState, useSaveConversionState, useUpdateConversionOutputPath, useUpdateConversionStatus } from "@/services/mutations";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ulid } from "ulid";
import { useThrottledCallback } from '@tanstack/react-pacer/throttler';
import * as fs from "@tauri-apps/plugin-fs";

const MAX_PARALLEL_CONVERSIONS = 1; // ffmpeg encodes are CPU-bound, unlike I/O-bound downloads

function getFileName(filePath: string): string {
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1];
}

function getFileExt(filePath: string): string | null {
    const name = getFileName(filePath);
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(idx + 1) : null;
}

function buildOutputPath(inputPath: string, targetExt: string): string {
    const lastDot = inputPath.lastIndexOf('.');
    const base = lastDot !== -1 ? inputPath.slice(0, lastDot) : inputPath;
    return `${base}.${targetExt}`;
}

interface ProbeResult {
    durationSeconds: number | null;
    hasVideo: boolean;
    sizeBytes: number | null;
}

async function probeFile(inputPath: string): Promise<ProbeResult> {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPath];
    const command = Command.sidecar('binaries/ffprobe', args);
    const output = await command.execute();
    if (output.code !== 0) {
        throw new Error(`ffprobe failed: ${output.stderr}`);
    }
    const parsed = JSON.parse(output.stdout);
    const hasVideo = (parsed.streams || []).some((s: any) => s.codec_type === 'video');
    const durationSeconds = parsed.format?.duration ? parseFloat(parsed.format.duration) : null;
    const sizeBytes = parsed.format?.size ? parseInt(parsed.format.size, 10) : null;
    return { durationSeconds, hasVideo, sizeBytes };
}

export default function useConverter() {
    const globalConversionStates = useConversionStatesStore((state) => state.conversionStates);
    const setConversionState = useConversionStatesStore((state) => state.setConversionState);
    const removeConversionState = useConversionStatesStore((state) => state.removeConversionState);

    const queryClient = useQueryClient();
    const conversionStateSaver = useSaveConversionState();
    const conversionStatusUpdater = useUpdateConversionStatus();
    const conversionOutputPathUpdater = useUpdateConversionOutputPath();
    const conversionStateDeleter = useDeleteConversionState();

    const ongoingConversions = globalConversionStates.filter(state => state.conversion_status === 'converting' || state.conversion_status === 'starting');
    const queuedConversions = globalConversionStates.filter(state => state.conversion_status === 'queued').sort((a, b) => (a.queue_index ?? 0) - (b.queue_index ?? 0));

    const isProcessingQueueRef = useRef(false);

    const updateConversionProgress = useThrottledCallback((state: ConversionState) => {
        conversionStateSaver.mutate(state, {
            onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: ['conversion-states'] });
            },
            onError: (error) => {
                console.error("Failed to save conversion state:", error);
            }
        });
    }, { key: 'update-conversion-progress', wait: 500 });

    const runConversion = async (initialState: ConversionState): Promise<void> => {
        const rawOutputPath = buildOutputPath(initialState.input_path, initialState.output_format);
        const outputPath = await generateSafeFilePath(rawOutputPath);

        const args = initialState.conversion_type === 'video_to_mp4'
            ? ['-y', '-i', initialState.input_path, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath]
            : ['-y', '-i', initialState.input_path, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', '-progress', 'pipe:1', '-nostats', outputPath];

        const command = Command.sidecar('binaries/ffmpeg', args);
        let buffer: Record<string, string> = {};
        // Mutable — the progress handler below must see process_id after spawn(),
        // not the initialState snapshot from before the process existed.
        let currentState: ConversionState = { ...initialState };

        command.stdout.on('data', (line: string) => {
            const trimmed = line.trim();
            if (trimmed === '') return;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) return;
            const key = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim();
            buffer[key] = value;

            if (key === 'progress') {
                const outTimeUs = buffer['out_time_us'] ? parseInt(buffer['out_time_us'], 10) : null;
                const speedStr = buffer['speed'] || '';
                const speed = speedStr.endsWith('x') ? parseFloat(speedStr.slice(0, -1)) : null;
                let percent: number | null = null;
                if (outTimeUs !== null && currentState.input_duration) {
                    percent = Math.min(100, (outTimeUs / 1_000_000 / currentState.input_duration) * 100);
                }
                currentState = {
                    ...currentState,
                    conversion_status: 'converting',
                    progress: percent,
                    speed: speed
                };
                updateConversionProgress(currentState);
                buffer = {};
            }
        });

        command.on('close', async (data: any) => {
            if (data.code === 0) {
                let filesize: number | null = null;
                try {
                    const outputExists = await fs.exists(outputPath);
                    if (outputExists) {
                        const info = await fs.stat(outputPath);
                        filesize = info.size;
                    }
                } catch (e) {
                    console.error(`Failed to stat converted output file: ${e}`);
                }
                const completedState: ConversionState = { ...currentState, conversion_status: 'completed', output_path: outputPath, filesize };
                setConversionState(completedState);
                conversionOutputPathUpdater.mutate({ conversion_id: currentState.conversion_id, output_path: outputPath, filesize }, {
                    onSuccess: () => {
                        conversionStatusUpdater.mutate({ conversion_id: currentState.conversion_id, conversion_status: 'completed' }, {
                            onSuccess: () => {
                                queryClient.invalidateQueries({ queryKey: ['conversion-states'] });
                                toast.success("Conversion Completed", {
                                    description: `"${currentState.input_filename}" was converted to .${currentState.output_format} successfully.`,
                                });
                            },
                            onError: (error) => console.error("Failed to update conversion status:", error)
                        });
                    },
                    onError: (error) => console.error("Failed to update conversion output path:", error)
                });
                processQueuedConversions();
            } else {
                const erroredState: ConversionState = { ...currentState, conversion_status: 'errored', error_message: `ffmpeg exited with code ${data.code}` };
                setConversionState(erroredState);
                conversionStatusUpdater.mutate({ conversion_id: currentState.conversion_id, conversion_status: 'errored', error_message: `ffmpeg exited with code ${data.code}` }, {
                    onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: ['conversion-states'] });
                        toast.error("Conversion Failed", {
                            description: `Failed to convert "${currentState.input_filename}".`,
                        });
                    },
                    onError: (error) => console.error("Failed to update conversion status:", error)
                });
                processQueuedConversions();
            }
        });

        command.on('error', (error: any) => {
            console.error(`Error converting file: ${error}`);
            const erroredState: ConversionState = { ...currentState, conversion_status: 'errored', error_message: String(error) };
            setConversionState(erroredState);
            conversionStatusUpdater.mutate({ conversion_id: currentState.conversion_id, conversion_status: 'errored', error_message: String(error) }, {
                onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: ['conversion-states'] });
                },
                onError: (err) => console.error("Failed to update conversion status:", err)
            });
            processQueuedConversions();
        });

        const child = await command.spawn();
        currentState = { ...currentState, conversion_status: 'converting', process_id: child.pid };
        conversionStateSaver.mutate(currentState, {
            onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: ['conversion-states'] });
            },
            onError: (error) => console.error("Failed to save conversion state:", error)
        });
    };

    const startConversion = async (inputPath: string): Promise<void> => {
        try {
            const probe = await probeFile(inputPath);
            const conversionType = probe.hasVideo ? 'video_to_mp4' : 'audio_to_wav';
            const outputFormat = probe.hasVideo ? 'mp4' : 'wav';

            // Always enqueue — processQueuedConversions (guarded by isProcessingQueueRef and
            // driven by fresh store reads) is the sole place that decides when to actually
            // start ffmpeg, so concurrency stays correctly capped even under rapid-fire calls
            // (e.g. batch picking many files at once).
            // queue_index is read fresh from the store (not the render-time closure) so a tight
            // loop of startConversion calls (batch picking) assigns distinct, increasing indices.
            const freshQueuedCount = useConversionStatesStore.getState().conversionStates.filter(s => s.conversion_status === 'queued').length;
            const state: ConversionState = {
                conversion_id: ulid(),
                conversion_status: 'queued',
                conversion_type: conversionType,
                queue_index: freshQueuedCount,
                input_path: inputPath,
                input_filename: getFileName(inputPath),
                input_ext: getFileExt(inputPath),
                input_filesize: probe.sizeBytes,
                input_duration: probe.durationSeconds,
                output_path: null,
                output_format: outputFormat,
                process_id: null,
                progress: null,
                speed: null,
                filesize: null,
                error_message: null
            };

            await conversionStateSaver.mutateAsync(state);
            setConversionState(state);
            queryClient.invalidateQueries({ queryKey: ['conversion-states'] });
        } catch (e) {
            console.error(`Failed to start conversion: ${e}`);
            toast.error("Conversion Failed", {
                description: `Failed to start converting "${getFileName(inputPath)}": ${e}`,
            });
            throw e;
        }
    };

    const cancelConversion = async (state: ConversionState): Promise<void> => {
        try {
            if ((state.conversion_status === 'converting' || state.conversion_status === 'starting') && state.process_id) {
                await invoke('kill_all_process', { pid: state.process_id });
            }
            removeConversionState(state.conversion_id);
            await conversionStateDeleter.mutateAsync(state.conversion_id);
            queryClient.invalidateQueries({ queryKey: ['conversion-states'] });
            isProcessingQueueRef.current = false;
            processQueuedConversions();
        } catch (e) {
            console.error(`Failed to cancel conversion: ${e}`);
            isProcessingQueueRef.current = false;
            throw e;
        }
    };

    // Deliberately reads live state via getState() instead of the closure-captured
    // queuedConversions/ongoingConversions above. Those are only used as useCallback deps,
    // to make this function's identity change (and re-trigger the App.tsx effect) whenever
    // conversions change — the actual admission decision must use fresh state, because
    // React re-renders (which update the closure) are not guaranteed to have landed yet
    // between successive calls, especially when driven by rapid batch-enqueue loops.
    // Without this, two calls could both see the same item as 'queued' and both promote
    // it, spawning ffmpeg twice for one conversion_id.
    const processQueuedConversions = useCallback(async () => {
        if (isProcessingQueueRef.current) return;

        const freshStates = useConversionStatesStore.getState().conversionStates;
        const freshOngoing = freshStates.filter(s => s.conversion_status === 'converting' || s.conversion_status === 'starting');
        const freshQueued = freshStates.filter(s => s.conversion_status === 'queued').sort((a, b) => (a.queue_index ?? 0) - (b.queue_index ?? 0));

        if (!freshQueued.length || freshOngoing.length >= MAX_PARALLEL_CONVERSIONS) return;

        try {
            isProcessingQueueRef.current = true;
            const currentState = freshQueued[0];

            const startingState: ConversionState = { ...currentState, conversion_status: 'starting', queue_index: null };
            // Synchronous store update, before any await — this is what actually closes the
            // race: any processQueuedConversions call that runs after this line (even one
            // already in flight when this one started) will see this item as no longer queued.
            setConversionState(startingState);
            await conversionStateSaver.mutateAsync(startingState);
            queryClient.invalidateQueries({ queryKey: ['conversion-states'] });

            await runConversion(startingState);
        } catch (e) {
            console.error("Error processing conversion queue:", e);
        } finally {
            isProcessingQueueRef.current = false;
        }
    }, [queuedConversions, ongoingConversions, queryClient]);

    return { startConversion, cancelConversion, processQueuedConversions };
}
