export type AppTheme = "dark" | "light";

export type AppSettings = {
  appearance: {
    theme: AppTheme;
  };
  sftp: {
    followTerminalCwdByDefault: boolean;
    followTerminalCwdPromptAcknowledged: boolean;
  };
};

export type AppSettingsSnapshot = AppSettings & {
  version: number;
};
