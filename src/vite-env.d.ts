/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_LOCAL_CHAT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
