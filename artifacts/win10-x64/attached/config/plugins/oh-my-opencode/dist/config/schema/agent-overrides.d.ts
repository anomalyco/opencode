import { z } from "zod";
export declare const AgentOverrideConfigSchema: z.ZodObject<{
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
}, z.core.$strip>;
export declare const AgentOverridesSchema: z.ZodObject<{
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
}, z.core.$strip>;
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>;
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>;
