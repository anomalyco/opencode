export declare namespace Scheduler {
    type Task = {
        id: string;
        interval: number;
        run: () => Promise<void>;
        scope?: "instance" | "global";
    };
    function register(task: Task): void;
}
