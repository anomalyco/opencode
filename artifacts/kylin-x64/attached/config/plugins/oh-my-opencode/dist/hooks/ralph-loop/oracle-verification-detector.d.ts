export interface OracleVerificationEvidence {
    agent: string;
    promise: string;
    sessionID?: string;
}
export declare function parseOracleVerificationEvidence(text: string): OracleVerificationEvidence | undefined;
export declare function isOracleVerified(text: string): boolean;
export declare function extractOracleSessionID(text: string): string | undefined;
