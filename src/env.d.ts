/// <reference types="vite/client" />

// Every file in public/ and its size in bytes, made by the publicFiles plugin in vite.config.ts.
declare module "virtual:public-files" {
  const files: Record<string, number>;
  export default files;
}
