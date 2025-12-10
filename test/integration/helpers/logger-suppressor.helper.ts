/**
 * Helper to suppress logger output during tests when errors are expected
 */
export class LoggerSuppressor {
  private static originalConsoleError: typeof console.error;
  private static originalConsoleWarn: typeof console.warn;
  private static suppressed: boolean = false;

  /**
   * Suppress console.error and console.warn output
   */
  static suppress(): void {
    if (this.suppressed) {
      return;
    }

    this.originalConsoleError = console.error;
    this.originalConsoleWarn = console.warn;

    console.error = jest.fn();
    console.warn = jest.fn();

    this.suppressed = true;
  }

  /**
   * Restore original console.error and console.warn
   */
  static restore(): void {
    if (!this.suppressed) {
      return;
    }

    if (this.originalConsoleError) {
      console.error = this.originalConsoleError;
    }
    if (this.originalConsoleWarn) {
      console.warn = this.originalConsoleWarn;
    }

    this.suppressed = false;
  }

  /**
   * Suppress logs only for specific error patterns
   */
  static suppressPatterns(patterns: string[]): void {
    if (this.suppressed) {
      return;
    }

    this.originalConsoleError = console.error;
    this.originalConsoleWarn = console.warn;

    // Using any[] here because Jest's mock function signature accepts any arguments
    // and console.error can accept any number of arguments of any type

    console.error = jest.fn((...args: any[]) => {
      const message = args[0]?.toString() || '';
      const shouldSuppress = patterns.some((pattern) =>
        message.includes(pattern),
      );

      if (!shouldSuppress && this.originalConsoleError) {
        this.originalConsoleError(...args);
      }
    });

    // Using any[] here because Jest's mock function signature accepts any arguments
    // and console.warn can accept any number of arguments of any type

    console.warn = jest.fn((...args: any[]) => {
      const message = args[0]?.toString() || '';
      const shouldSuppress = patterns.some((pattern) =>
        message.includes(pattern),
      );

      if (!shouldSuppress && this.originalConsoleWarn) {
        this.originalConsoleWarn(...args);
      }
    });

    this.suppressed = true;
  }
}
