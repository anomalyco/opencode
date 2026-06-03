import type { SkillInfo } from "./types";
import type { LoadedSkill } from "../../features/opencode-skill-loader";
export type NativeSkillEntry = {
    name: string;
    description: string;
    location: string;
    content: string;
};
export declare function loadedSkillToInfo(skill: LoadedSkill): SkillInfo;
export declare function mergeNativeSkills(skills: LoadedSkill[], nativeSkills: NativeSkillEntry[]): void;
export declare function mergeNativeSkillInfos(skillInfos: SkillInfo[], nativeSkills: NativeSkillEntry[]): void;
export declare function isPromiseLike<TValue>(value: TValue | Promise<TValue>): value is Promise<TValue>;
