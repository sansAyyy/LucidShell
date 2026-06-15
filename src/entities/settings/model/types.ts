export type AppTheme = "dark" | "light";

export type AppSettings = {
  appearance: {
    theme: AppTheme;
  };
  diagnostics: {
    enabled: boolean;
  };
  sftp: {
    followTerminalCwdByDefault: boolean;
    followTerminalCwdPromptAcknowledged: boolean;
  };
};

export type AppSettingsSnapshot = AppSettings & {
  version: number;
};
