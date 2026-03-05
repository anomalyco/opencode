import { GlobalBus } from "@/bus/global";
import { Flag } from "@/flag/flag";
import { Filesystem } from "@/util/filesystem";
import { iife } from "@/util/iife";
import { Log } from "@/util/log";
import { Context } from "../util/context";
import { Project } from "./project";
import { State } from "./state";

interface Context {
	directory: string;
	worktree: string;
	project: Project.Info;
}
const log = Log.create({ service: "instance" });
const context = Context.create<Context>("instance");
const cache = new Map<string, Promise<Context>>();
const refs = new Map<string, number>();
const timers = new Map<string, Timer>();

const disposal = {
	all: undefined as Promise<void> | undefined,
};

function acquire(dir: string) {
	const pending = timers.get(dir);
	if (pending) {
		clearTimeout(pending);
		timers.delete(dir);
	}
	refs.set(dir, (refs.get(dir) ?? 0) + 1);
}

function release(dir: string) {
	const count = (refs.get(dir) ?? 1) - 1;
	if (count > 0) {
		refs.set(dir, count);
		return;
	}
	refs.delete(dir);

	const timeout = Flag.OPENCODE_IDLE_TIMEOUT;
	if (!timeout) return;
	if (!cache.has(dir)) return;

	const timer = setTimeout(() => {
		timers.delete(dir);
		if (refs.has(dir)) return;
		if (!cache.has(dir)) return;
		idle(dir);
	}, timeout);
	timer.unref();
	timers.set(dir, timer);
}

async function idle(dir: string) {
	const entry = cache.get(dir);
	if (!entry) return;
	cache.delete(dir);

	const ctx = await entry.catch(() => undefined);
	if (!ctx) return;

	log.info("idle timeout, disposing instance", { directory: dir });
	await context.provide(ctx, async () => {
		await State.dispose(dir);
	});
	GlobalBus.emit("event", {
		directory: dir,
		payload: {
			type: "server.instance.disposed",
			properties: {
				directory: dir,
			},
		},
	});
}

export const Instance = {
	async provide<R>(input: {
		directory: string;
		init?: () => Promise<any>;
		fn: () => R;
	}): Promise<R> {
		const dir = input.directory;
		acquire(dir);
		try {
			let existing = cache.get(dir);
			if (!existing) {
				log.info("creating instance", { directory: dir });
				existing = iife(async () => {
					const { project, sandbox } = await Project.fromDirectory(dir);
					const ctx = {
						directory: dir,
						worktree: sandbox,
						project,
					};
					await context.provide(ctx, async () => {
						await input.init?.();
					});
					return ctx;
				});
				cache.set(dir, existing);
			}
			const ctx = await existing;
			return await context.provide(ctx, async () => {
				return input.fn();
			});
		} finally {
			release(dir);
		}
	},
	get directory() {
		return context.use().directory;
	},
	get worktree() {
		return context.use().worktree;
	},
	get project() {
		return context.use().project;
	},
	/**
	 * Check if a path is within the project boundary.
	 * Returns true if path is inside Instance.directory OR Instance.worktree.
	 * Paths within the worktree but outside the working directory should not trigger external_directory permission.
	 */
	containsPath(filepath: string) {
		if (Filesystem.contains(Instance.directory, filepath)) return true;
		// Non-git projects set worktree to "/" which would match ANY absolute path.
		// Skip worktree check in this case to preserve external_directory permissions.
		if (Instance.worktree === "/") return false;
		return Filesystem.contains(Instance.worktree, filepath);
	},
	state<S>(
		init: () => S,
		dispose?: (state: Awaited<S>) => Promise<void>,
	): () => S {
		return State.create(() => Instance.directory, init, dispose);
	},
	async dispose() {
		const dir = Instance.directory;
		const pending = timers.get(dir);
		if (pending) {
			clearTimeout(pending);
			timers.delete(dir);
		}
		log.info("disposing instance", { directory: dir });
		await State.dispose(dir);
		cache.delete(dir);
		GlobalBus.emit("event", {
			directory: dir,
			payload: {
				type: "server.instance.disposed",
				properties: {
					directory: dir,
				},
			},
		});
	},
	async disposeAll() {
		if (disposal.all) return disposal.all;

		for (const timer of timers.values()) {
			clearTimeout(timer);
		}
		timers.clear();

		disposal.all = iife(async () => {
			log.info("disposing all instances");
			const entries = [...cache.entries()];
			for (const [key, value] of entries) {
				if (cache.get(key) !== value) continue;

				const ctx = await value.catch((error) => {
					log.warn("instance dispose failed", { key, error });
					return undefined;
				});

				if (!ctx) {
					if (cache.get(key) === value) cache.delete(key);
					continue;
				}

				if (cache.get(key) !== value) continue;

				await context.provide(ctx, async () => {
					await Instance.dispose();
				});
			}
		}).finally(() => {
			disposal.all = undefined;
		});

		return disposal.all;
	},
	list() {
		const result: { directory: string; refs: number }[] = [];
		for (const dir of cache.keys()) {
			result.push({ directory: dir, refs: refs.get(dir) ?? 0 });
		}
		return result;
	},
	async disposeByDirectory(dir: string) {
		const entry = cache.get(dir);
		if (!entry) return false;

		const pending = timers.get(dir);
		if (pending) {
			clearTimeout(pending);
			timers.delete(dir);
		}

		cache.delete(dir);

		const ctx = await entry.catch(() => undefined);
		if (!ctx) return false;

		log.info("disposing instance by directory", { directory: dir });
		await context.provide(ctx, async () => {
			await State.dispose(dir);
		});
		GlobalBus.emit("event", {
			directory: dir,
			payload: {
				type: "server.instance.disposed",
				properties: {
					directory: dir,
				},
			},
		});
		return true;
	},
};
