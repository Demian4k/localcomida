/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
