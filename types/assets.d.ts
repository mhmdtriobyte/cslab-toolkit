// Vite asset imports: `import url from './file.wasm?url'` gives the file's final URL.
declare module '*?url' {
  const url: string;
  export default url;
}
