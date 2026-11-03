export function prepareDemoContext(directory: string): Promise<void>;
export function validateDemoDirectory(directory: string): Promise<string>;
export function copyDemoContext(source: string, destination: string): Promise<void>;
export function restoreDemoSnapshot(source: string, destination: string): Promise<string>;
