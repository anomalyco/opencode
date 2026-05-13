import type { Provider } from "@/provider/provider";
export declare namespace SystemPrompt {
    function instructions(): string;
    function hosted(): string[];
    function provider(model: Provider.Model): string[];
    function environment(model: Provider.Model): Promise<string[]>;
}
