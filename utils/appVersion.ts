export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD_COMMIT = __APP_BUILD_COMMIT__;
export const APP_BUILD_TIME = __APP_BUILD_TIME__;

export const APP_BUILD_TIME_LABEL = new Date(APP_BUILD_TIME).toLocaleString('de-DE', {
  dateStyle: 'short',
  timeStyle: 'medium',
});
