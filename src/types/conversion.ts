export interface ConversionState {
    conversion_id: string;
    conversion_status: string;
    conversion_type: string;
    queue_index: number | null;
    input_path: string;
    input_filename: string;
    input_ext: string | null;
    input_filesize: number | null;
    input_duration: number | null;
    output_path: string | null;
    output_format: string;
    process_id: number | null;
    progress: number | null;
    speed: number | null;
    filesize: number | null;
    error_message: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface ConversionProgress {
    progress: number | null;
    speed: number | null;
    out_time_us: number | null;
}
