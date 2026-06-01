import {Output} from "../core/ports/output.ts";

export class StandardOutput implements Output {
    async write(data: string): Promise<void> {
        return new Promise((resolve, reject) => {
            process.stdout.write(data, (err) => {
                if (err) {
                    reject(err);
                }
                resolve();
            });
        });
    }
}
