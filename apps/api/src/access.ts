import { Role } from "@prisma/client";
import { prisma } from "./prisma.js";
import type { AuthUser } from "./types.js";

/**
 * Return a task only when the current user
 * is allowed to access that task.
 *
 * ADMIN:
 *   Can access every task.
 *
 * PROJECT_MANAGER:
 *   Can access tasks only from projects
 *   created by that PM.
 *
 * DEVELOPER:
 *   Can access only tasks assigned to them.
 */
export async function taskFor(
  user: AuthUser,
  taskId: string
) {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    include: {
      project: true,
      assignee: true,
    },
  });

  if (!task) {
    return null;
  }

  // ADMIN can access every task
  if (user.role === Role.ADMIN) {
    return task;
  }

  // PROJECT_MANAGER can access only
  // tasks belonging to their projects
  if (
    user.role === Role.PROJECT_MANAGER &&
    task.project.creatorId === user.id
  ) {
    return task;
  }

  // DEVELOPER can access only
  // tasks assigned to themselves
  if (
    user.role === Role.DEVELOPER &&
    task.assigneeId === user.id
  ) {
    return task;
  }

  // Do not reveal whether the task exists
  // to an unauthorized user.
  return null;
}

/**
 * Return a project only when the current user
 * is allowed to access that project.
 */
export async function projectFor(
  user: AuthUser,
  projectId: string
) {
  const project =
    await prisma.project.findUnique({
      where: {
        id: projectId,
      },
    });

  if (!project) {
    return null;
  }

  // ADMIN can access every project
  if (user.role === Role.ADMIN) {
    return project;
  }

  // PROJECT_MANAGER can access only
  // projects created by themselves
  if (
    user.role === Role.PROJECT_MANAGER &&
    project.creatorId === user.id
  ) {
    return project;
  }

  // Developers do not have project-level access
  return null;
}

/**
 * Build Prisma filters for list endpoints.
 *
 * ADMIN:
 *   no restriction
 *
 * PROJECT_MANAGER:
 *   only tasks from their own projects
 *
 * DEVELOPER:
 *   only their assigned tasks
 */
export function scopeFor(
  user: AuthUser
) {
  if (user.role === Role.ADMIN) {
    return {};
  }

  if (
    user.role === Role.PROJECT_MANAGER
  ) {
    return {
      project: {
        creatorId: user.id,
      },
    };
  }

  return {
    assigneeId: user.id,
  };
}