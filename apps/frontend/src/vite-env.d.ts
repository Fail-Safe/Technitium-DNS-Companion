/// <reference types="vite/client" />

// Global constants injected by Vite
declare const __APP_NAME__: string;
declare const __APP_SHORT_NAME__: string;
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    readonly VITE_HTTPS_ENABLED?: string;
    readonly VITE_HTTPS_PORT?: string;
    readonly VITE_HTTPS_CERT_PATH?: string;
    readonly VITE_HTTPS_KEY_PATH?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
