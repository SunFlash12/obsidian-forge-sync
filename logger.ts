export class Logger {
  static debugMode = false;

  private static formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [ForgeSync] [${level}] ${message}`;
  }

  static info(message: string, ...optionalParams: any[]) {
    if (this.debugMode) {
      console.log(this.formatMessage('INFO', message), ...optionalParams);
    }
  }

  static warn(message: string, ...optionalParams: any[]) {
    if (this.debugMode) {
      console.warn(this.formatMessage('WARN', message), ...optionalParams);
    }
  }

  static error(message: string, ...optionalParams: any[]) {
    // Always log errors regardless of debug mode
    console.error(this.formatMessage('ERROR', message), ...optionalParams);
  }
}
