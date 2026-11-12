/** Name shown in the header, the home page and the browser tab. */
export const APP_NAME = 'CS Lab Toolkit';

/** Repository link shown in the header; set VITE_REPO_URL when deploying a fork. */
export const REPO_URL: string =
  (import.meta.env.VITE_REPO_URL as string | undefined) ??
  'https://github.com/mhmdtriobyte/cs-lab-toolkit';
