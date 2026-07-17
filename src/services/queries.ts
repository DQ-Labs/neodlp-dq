import { useQuery } from "@tanstack/react-query";
import { fetchAllConversionStates, fetchAllDownloadStates, fetchAllKvPairs, fetchAllSettings } from "@/services/database";

export function useFetchAllDownloadStates() {
    return useQuery({
        queryKey: ['download-states'],
        queryFn: () => fetchAllDownloadStates()
    })
}

export function useFetchAllConversionStates() {
    return useQuery({
        queryKey: ['conversion-states'],
        queryFn: () => fetchAllConversionStates()
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