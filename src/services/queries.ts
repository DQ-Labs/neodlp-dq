import { useQuery } from "@tanstack/react-query";
import { fetchAllConversionStates, fetchAllDownloadStates, fetchAllKvPairs, fetchAllSettings } from "@/services/database";
import { recoverInterruptedConversions } from "@/helpers/use-converter";

export function useFetchAllDownloadStates() {
    return useQuery({
        queryKey: ['download-states'],
        queryFn: () => fetchAllDownloadStates()
    })
}

export function useFetchAllConversionStates() {
    return useQuery({
        queryKey: ['conversion-states'],
        // Recovery runs once per app session, before the first load populates the store —
        // so the queue never sees an interrupted conversion as still running.
        queryFn: async () => {
            await recoverInterruptedConversions();
            return fetchAllConversionStates();
        }
    })
}

export function useFetchAllSettings() {
    return useQuery({
        queryKey: ['settings'],
        queryFn: () => fetchAllSettings()
    })
}

export function useFetchAllkVPairs() {
    return useQuery({
        queryKey: ['kv-pairs'],
        queryFn: () => fetchAllKvPairs()
    })
}