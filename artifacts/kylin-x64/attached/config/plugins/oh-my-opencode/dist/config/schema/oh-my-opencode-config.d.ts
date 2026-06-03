import { z } from "zod";
export declare const OhMyOpenCodeConfigSchema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    new_task_system_enabled: z.ZodOptional<z.ZodBoolean>;
    default_run_agent: z.ZodOptional<z.ZodString>;
    agent_definitions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabled_mcps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabled_agents: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabled_skills: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        playwright: "playwright";
        "agent-browser": "agent-browser";
        "dev-browser": "dev-browser";
        "frontend-ui-ux": "frontend-ui-ux";
        "git-master": "git-master";
        "review-work": "review-work";
        "ai-slop-remover": "ai-slop-remover";
    }>>>;
    disabled_hooks: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabled_commands: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        "init-deep": "init-deep";
        "ralph-loop": "ralph-loop";
        "ulw-loop": "ulw-loop";
        "cancel-ralph": "cancel-ralph";
        refactor: "refactor";
        "start-work": "start-work";
        "stop-continuation": "stop-continuation";
        "remove-ai-slops": "remove-ai-slops";
    }>>>;
    disabled_tools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    mcp_env_allowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
    hashline_edit: z.ZodOptional<z.ZodBoolean>;
    model_fallback: z.ZodOptional<z.ZodBoolean>;
    agents: z.ZodOptional<z.ZodObject<{
        build: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        plan: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        sisyphus: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        hephaestus: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            allow_non_gpt_model: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        "sisyphus-junior": z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        "OpenCode-Builder": z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        prometheus: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        metis: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        momus: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        oracle: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        librarian: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        explore: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        "multimodal-looker": z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        atlas: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    none: "none";
                    minimal: "minimal";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        enabled: "enabled";
                        disabled: "disabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                primary: "primary";
                subagent: "subagent";
                all: "all";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    ask: "ask";
                    allow: "allow";
                    deny: "deny";
                }>>;
            }, z.core.$strip>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    categories: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        description: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
            model: z.ZodString;
            variant: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            model: z.ZodString;
            variant: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                none: "none";
                minimal: "minimal";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
            }>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    enabled: "enabled";
                    disabled: "disabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>]>>]>>;
        variant: z.ZodOptional<z.ZodString>;
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        thinking: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<{
                enabled: "enabled";
                disabled: "disabled";
            }>;
            budgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            minimal: "minimal";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
        }>>;
        textVerbosity: z.ZodOptional<z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
        }>>;
        tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        prompt_append: z.ZodOptional<z.ZodString>;
        max_prompt_tokens: z.ZodOptional<z.ZodNumber>;
        is_unstable_agent: z.ZodOptional<z.ZodBoolean>;
        disable: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
    claude_code: z.ZodOptional<z.ZodObject<{
        mcp: z.ZodOptional<z.ZodBoolean>;
        commands: z.ZodOptional<z.ZodBoolean>;
        skills: z.ZodOptional<z.ZodBoolean>;
        agents: z.ZodOptional<z.ZodBoolean>;
        hooks: z.ZodOptional<z.ZodBoolean>;
        plugins: z.ZodOptional<z.ZodBoolean>;
        plugins_override: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    }, z.core.$strip>>;
    sisyphus_agent: z.ZodOptional<z.ZodObject<{
        disabled: z.ZodOptional<z.ZodBoolean>;
        default_builder_enabled: z.ZodOptional<z.ZodBoolean>;
        planner_enabled: z.ZodOptional<z.ZodBoolean>;
        replace_plan: z.ZodOptional<z.ZodBoolean>;
        tdd: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    }, z.core.$strip>>;
    comment_checker: z.ZodOptional<z.ZodObject<{
        custom_prompt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    experimental: z.ZodOptional<z.ZodObject<{
        aggressive_truncation: z.ZodOptional<z.ZodBoolean>;
        auto_resume: z.ZodOptional<z.ZodBoolean>;
        preemptive_compaction: z.ZodOptional<z.ZodBoolean>;
        truncate_all_tool_outputs: z.ZodOptional<z.ZodBoolean>;
        dynamic_context_pruning: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            notification: z.ZodDefault<z.ZodEnum<{
                minimal: "minimal";
                off: "off";
                detailed: "detailed";
            }>>;
            turn_protection: z.ZodOptional<z.ZodObject<{
                enabled: z.ZodDefault<z.ZodBoolean>;
                turns: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>>;
            protected_tools: z.ZodDefault<z.ZodArray<z.ZodString>>;
            strategies: z.ZodOptional<z.ZodObject<{
                deduplication: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodDefault<z.ZodBoolean>;
                }, z.core.$strip>>;
                supersede_writes: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodDefault<z.ZodBoolean>;
                    aggressive: z.ZodDefault<z.ZodBoolean>;
                }, z.core.$strip>>;
                purge_errors: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodDefault<z.ZodBoolean>;
                    turns: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        task_system: z.ZodOptional<z.ZodBoolean>;
        plugin_load_timeout_ms: z.ZodOptional<z.ZodNumber>;
        safe_hook_creation: z.ZodOptional<z.ZodBoolean>;
        disable_omo_env: z.ZodOptional<z.ZodBoolean>;
        hashline_edit: z.ZodOptional<z.ZodBoolean>;
        model_fallback_title: z.ZodOptional<z.ZodBoolean>;
        max_tools: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    auto_update: z.ZodOptional<z.ZodBoolean>;
    skills: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
        sources: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            path: z.ZodString;
            recursive: z.ZodOptional<z.ZodBoolean>;
            glob: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>]>>>;
        enable: z.ZodOptional<z.ZodArray<z.ZodString>>;
        disable: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$catchall<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        description: z.ZodOptional<z.ZodString>;
        template: z.ZodOptional<z.ZodString>;
        from: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        agent: z.ZodOptional<z.ZodString>;
        subtask: z.ZodOptional<z.ZodBoolean>;
        "argument-hint": z.ZodOptional<z.ZodString>;
        license: z.ZodOptional<z.ZodString>;
        compatibility: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        "allowed-tools": z.ZodOptional<z.ZodArray<z.ZodString>>;
        disable: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>]>>>]>>;
    ralph_loop: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        default_max_iterations: z.ZodDefault<z.ZodNumber>;
        state_dir: z.ZodOptional<z.ZodString>;
        default_strategy: z.ZodDefault<z.ZodEnum<{
            reset: "reset";
            continue: "continue";
        }>>;
    }, z.core.$strip>>;
    runtime_fallback: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        retry_on_errors: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        max_fallback_attempts: z.ZodOptional<z.ZodNumber>;
        cooldown_seconds: z.ZodOptional<z.ZodNumber>;
        timeout_seconds: z.ZodOptional<z.ZodNumber>;
        notify_on_fallback: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>]>>;
    background_task: z.ZodOptional<z.ZodObject<{
        defaultConcurrency: z.ZodOptional<z.ZodNumber>;
        providerConcurrency: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        modelConcurrency: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        maxDepth: z.ZodOptional<z.ZodNumber>;
        staleTimeoutMs: z.ZodOptional<z.ZodNumber>;
        messageStalenessTimeoutMs: z.ZodOptional<z.ZodNumber>;
        taskTtlMs: z.ZodOptional<z.ZodNumber>;
        sessionGoneTimeoutMs: z.ZodOptional<z.ZodNumber>;
        syncPollTimeoutMs: z.ZodOptional<z.ZodNumber>;
        maxToolCalls: z.ZodOptional<z.ZodNumber>;
        circuitBreaker: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            maxToolCalls: z.ZodOptional<z.ZodNumber>;
            consecutiveThreshold: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    notification: z.ZodOptional<z.ZodObject<{
        force_enable: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    model_capabilities: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        auto_refresh_on_start: z.ZodOptional<z.ZodBoolean>;
        refresh_timeout_ms: z.ZodOptional<z.ZodNumber>;
        source_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    openclaw: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        gateways: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            type: z.ZodDefault<z.ZodEnum<{
                command: "command";
                http: "http";
            }>>;
            url: z.ZodOptional<z.ZodString>;
            method: z.ZodDefault<z.ZodString>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            command: z.ZodOptional<z.ZodString>;
            timeout: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        hooks: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            gateway: z.ZodString;
            instruction: z.ZodString;
        }, z.core.$strip>>>;
        replyListener: z.ZodOptional<z.ZodObject<{
            discordBotToken: z.ZodOptional<z.ZodString>;
            discordChannelId: z.ZodOptional<z.ZodString>;
            discordMention: z.ZodOptional<z.ZodString>;
            authorizedDiscordUserIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
            telegramBotToken: z.ZodOptional<z.ZodString>;
            telegramChatId: z.ZodOptional<z.ZodString>;
            pollIntervalMs: z.ZodDefault<z.ZodNumber>;
            rateLimitPerMinute: z.ZodDefault<z.ZodNumber>;
            maxMessageLength: z.ZodDefault<z.ZodNumber>;
            includePrefix: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    babysitting: z.ZodOptional<z.ZodObject<{
        timeout_ms: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    git_master: z.ZodDefault<z.ZodObject<{
        commit_footer: z.ZodDefault<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>;
        include_co_authored_by: z.ZodDefault<z.ZodBoolean>;
        git_env_prefix: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    browser_automation_engine: z.ZodOptional<z.ZodObject<{
        provider: z.ZodDefault<z.ZodEnum<{
            playwright: "playwright";
            "agent-browser": "agent-browser";
            "dev-browser": "dev-browser";
            "playwright-cli": "playwright-cli";
        }>>;
    }, z.core.$strip>>;
    websearch: z.ZodOptional<z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            exa: "exa";
            tavily: "tavily";
        }>>;
    }, z.core.$strip>>;
    tmux: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        layout: z.ZodDefault<z.ZodEnum<{
            "main-horizontal": "main-horizontal";
            "main-vertical": "main-vertical";
            tiled: "tiled";
            "even-horizontal": "even-horizontal";
            "even-vertical": "even-vertical";
        }>>;
        main_pane_size: z.ZodDefault<z.ZodNumber>;
        main_pane_min_width: z.ZodDefault<z.ZodNumber>;
        agent_pane_min_width: z.ZodDefault<z.ZodNumber>;
        isolation: z.ZodDefault<z.ZodEnum<{
            session: "session";
            inline: "inline";
            window: "window";
        }>>;
    }, z.core.$strip>>;
    sisyphus: z.ZodOptional<z.ZodObject<{
        tasks: z.ZodOptional<z.ZodObject<{
            storage_path: z.ZodOptional<z.ZodString>;
            task_list_id: z.ZodOptional<z.ZodString>;
            claude_code_compat: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    start_work: z.ZodOptional<z.ZodObject<{
        auto_commit: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    _migrations: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>;
