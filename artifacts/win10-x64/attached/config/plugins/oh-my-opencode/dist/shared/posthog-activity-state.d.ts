type PostHogActivityCaptureState = {
    dayUTC: string;
    hourUTC: string;
    captureDaily: boolean;
    captureHourly: boolean;
};
export declare function getPostHogActivityCaptureState(now?: Date): PostHogActivityCaptureState;
export {};
