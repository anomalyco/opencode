import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { resolver } from "hono-openapi";
import { Instance } from "../../project/instance";
import { Project } from "../../project/project";
import z from "zod";
import { ProjectID } from "../../project/schema";
import { errors } from "../error";
import { lazy } from "../../util/lazy";
import { InstanceBootstrap } from "../../project/bootstrap";
import path from "path";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { git } from "../../util/git";
import { which } from "../../util/which";
import { assertHostedFilesystemEnabled } from "../hosted";
import { createProjectSimple, listProjectsSimple } from "../../storage/project-pg";

const CreateProjectInput = z.object({
	name: z.string().trim().min(1).max(120),
});

const CreateProjectOutput = z.object({
	directory: z.string(),
	project: Project.Info,
});

function slugifyProjectName(input: string) {
	const slug = input
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "project";
}

function projectRoot() {
	return process.env.OPENCODE_PROJECTS_ROOT || process.cwd();
}

export const ProjectRoutes = lazy(() =>
	new Hono()
		.get(
			"/",
			describeRoute({
				summary: "List all projects",
				description: "Get a list of projects that have been opened with OpenCode.",
				operationId: "project.list",
				responses: {
					200: {
						description: "List of projects",
						content: {
							"application/json": {
								schema: resolver(Project.Info.array()),
							},
						},
					},
				},
			}),
			async (c) => {
				if (process.env.DATABASE_URL?.startsWith("postgresql://")) {
					const tenantUserId = process.env.VERITLY_TENANT_USER_ID ?? "default";
					const projects = await listProjectsSimple(tenantUserId);
					return c.json(projects);
				}
				const projects = await Project.list();
				return c.json(projects);
			},
		)
		.get(
			"/current",
			describeRoute({
				summary: "Get current project",
				description: "Retrieve the currently active project that OpenCode is working with.",
				operationId: "project.current",
				responses: {
					200: {
						description: "Current project information",
						content: {
							"application/json": {
								schema: resolver(Project.Info),
							},
						},
					},
				},
			}),
			async (c) => {
				return c.json(Instance.project);
			},
		)
		.post(
			"/create",
			describeRoute({
				summary: "Create project",
				description: "Create a new project in the database.",
				operationId: "project.create",
				responses: {
					200: {
						description: "Created project information",
						content: {
							"application/json": {
								schema: resolver(CreateProjectOutput),
							},
						},
					},
					...errors(400),
				},
			}),
			validator("json", CreateProjectInput),
			async (c) => {
				const body = c.req.valid("json");

				if (process.env.DATABASE_URL?.startsWith("postgresql://")) {
					const tenantUserId = process.env.VERITLY_TENANT_USER_ID ?? "default";
					const result = await createProjectSimple({ name: body.name, tenantUserId });
					return c.json(result);
				}

				assertHostedFilesystemEnabled();
				const root = projectRoot();
				const base = slugifyProjectName(body.name);

				let directory = path.join(root, base);
				let counter = 2;
				while (existsSync(directory)) {
					directory = path.join(root, `${base}-${counter}`);
					counter += 1;
				}

				await mkdir(directory, { recursive: true });

				if (!which("git")) throw new Error("Git is required to create a project");

				const result = await git(["init", "--quiet"], { cwd: directory });
				if (result.exitCode !== 0) {
					const message = result.stderr.toString().trim() || result.text().trim() || "Failed to initialize project";
					throw new Error(message);
				}

				let project = (await Project.fromDirectory(directory)).project;
				if (project.name !== body.name) {
					project = await Project.update({
						projectID: project.id,
						name: body.name,
					});
				}

				return c.json({ directory, project });
			},
		),
);
