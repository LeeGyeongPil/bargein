export type BargeinErrorCode = 'WORKLET_LOAD_FAILED' | 'CONTEXT_SUSPENDED' | 'BAD_AUDIO' | 'CLOSED';

/** Error thrown by bargein. Check `code` to react programmatically. */
export class BargeinError extends Error {
  code: BargeinErrorCode;
  constructor(code: BargeinErrorCode, message: string) {
    super(message);
    this.name = 'BargeinError';
    this.code = code;
  }
}
