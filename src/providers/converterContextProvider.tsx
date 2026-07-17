import { ConversionState } from '@/types/conversion';
import { createContext, useContext } from 'react';

interface ConverterContextType {
    startConversion: (inputPath: string) => Promise<void>;
    cancelConversion: (state: ConversionState) => Promise<void>;
}

export const ConverterContext = createContext<ConverterContextType>({
    startConversion: async () => {},
    cancelConversion: async () => {}
});

export const useConverterContext = () => useContext(ConverterContext);
